import { createEvidence } from "@/lib/financial/p0a/evidence";
import { Prisma } from "@prisma/client";
import { parseFinancialDecimal, sumFinancialDecimals } from "@/lib/financial/p0a/decimal";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type {
  P0AEvidence,
  P0AIndexedPage,
  P0AIssuerContext,
  P0ANativeObservation,
  P0APageToken,
  P0APlanTask,
  P0ARoutedPage,
  P0AStatementType,
} from "@/lib/financial/p0a/types";
import {
  P0A_NATIVE_MAPPING_VERSION,
  P0A_PARSER_VERSION,
  P0A_ROUTER_VERSION,
  P0A_VALIDATION_VERSION,
} from "@/lib/financial/p0a/versions";

type LayoutRow = { rowIndex: number; y: number; tokens: P0APageToken[]; text: string; normalized: string };
type NumericRun = { raw: string; decimal: string; zero: boolean; x1: number; x2: number; center: number; tokens: P0APageToken[] };
type PeriodColumns = { currentCenter: number; comparativeCenter: number; boundary: number; currentOnLeft: boolean; confidence: number };
type LogicalRow = { row: LayoutRow; label: string; normalizedLabel: string; current: NumericRun; columns: PeriodColumns };

type NativeRule = {
  requirementId: string;
  aliases: readonly RegExp[];
  statement: P0AStatementType;
  mappingConfidence?: number;
  special?: "SHARES_ISSUED";
  excludes?: readonly RegExp[];
};

const RULES: readonly NativeRule[] = [
  { requirementId: "REV_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\bpenjualan neto\b/, /\bnet sales\b/, /\bpendapatan neto\b/, /\bnet revenue\b/] },
  { requirementId: "COGS_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\bbeban pokok penjualan\b/, /\bcost of goods sold\b/, /\bcost of sales\b/] },
  { requirementId: "GROSS_PROFIT_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\blaba bruto\b/, /\bgross profit\b/] },
  { requirementId: "OPERATING_PROFIT_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\blaba usaha\b/, /\bincome from operations\b/, /\boperating profit\b/] },
  { requirementId: "FINANCE_INCOME_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\bpendapatan keuangan\b/, /\bfinance income\b/] },
  { requirementId: "FINANCE_COST_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\bbeban keuangan\b/, /\bfinance expenses?\b/, /\bfinance costs?\b/] },
  { requirementId: "PRETAX_PROFIT_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\blaba sebelum .*pajak.*penghasilan\b/, /\bincome before .*income tax.*expense\b/, /\bprofit before (?:income )?tax\b/] },
  { requirementId: "TAX_EXPENSE_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\bbeban pajak penghasilan\b/, /\bincome tax expense\b/] },
  { requirementId: "NET_PROFIT_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\blaba periode be r?jalan\b/, /\blaba periode berjalan\b/, /\bincome for the period\b/], excludes: [/\battribut/, /\bdiatr/, /\bkomprehensif\b/, /\bcomprehensive\b/] },
  { requirementId: "NET_PROFIT_PARENT_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\bpemilik entitas induk\b/, /\bequity holders? of the parent entity\b/, /\bowners? of the parent\b/], excludes: [/\bkomprehensif\b/, /\bcomprehensive\b/] },
  { requirementId: "EPS_BASIC_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\blaba per saham dasar\b/, /\bbasic earnings per share\b/] },
  { requirementId: "CASH_REPORTED", statement: "BALANCE_SHEET", aliases: [/\bkas dan setara kas\b/, /\bcash and cash equivalents\b/] },
  { requirementId: "AR_REPORTED", statement: "BALANCE_SHEET", aliases: [/\bpiutang usaha neto\b/, /\btrade (?:accounts )?receivables? net\b/] },
  { requirementId: "INV_REPORTED", statement: "BALANCE_SHEET", aliases: [/\bpersediaan neto\b/, /\binventories net\b/] },
  { requirementId: "CURRENT_ASSETS_REPORTED", statement: "BALANCE_SHEET", aliases: [/\btotal aset lancar\b/, /\btotal current assets\b/] },
  { requirementId: "PPE_REPORTED", statement: "BALANCE_SHEET", aliases: [/\baset tetap neto\b/, /\bfixed assets net\b/, /\bproperty plant and equipment net\b/] },
  { requirementId: "TOTAL_ASSETS_REPORTED", statement: "BALANCE_SHEET", aliases: [/\btotal aset(?! lancar| tidak)\b/, /\btotal assets(?! and| current| non)\b/] },
  { requirementId: "AP_REPORTED", statement: "BALANCE_SHEET", aliases: [/\butang usaha neto\b/, /\btrade (?:accounts )?payables? net\b/] },
  { requirementId: "SHORT_TERM_DEBT_REPORTED", statement: "BALANCE_SHEET", aliases: [/\btotal utang jangka pendek berbunga\b/, /\btotal short term debt\b/] },
  { requirementId: "CURRENT_LIAB_REPORTED", statement: "BALANCE_SHEET", aliases: [/\btotal liabilitas jangka pendek\b/, /\btotal current liabilities\b/] },
  { requirementId: "LONG_TERM_DEBT_REPORTED", statement: "BALANCE_SHEET", aliases: [/\btotal utang jangka panjang berbunga\b/, /\btotal long term debt\b/] },
  { requirementId: "TOTAL_LIAB_REPORTED", statement: "BALANCE_SHEET", aliases: [/\btotal liabilitas(?! jangka| dan)\b/, /\btotal liabilities(?! and| current| non)\b/] },
  { requirementId: "EQUITY_REPORTED", statement: "BALANCE_SHEET", aliases: [/\btotal ekuitas\b/, /\btotal equity\b/] },
  { requirementId: "EQUITY_PARENT_REPORTED", statement: "BALANCE_SHEET", aliases: [/\bekuitas yang dapat diatribusikan.*pemilik entitas induk\b/, /\bequity attributable to equity holders of the parent entity\b/] },
  { requirementId: "NCI_REPORTED", statement: "BALANCE_SHEET", aliases: [/\bkepentingan nonpengendali\b/, /\bnon controlling interests\b/], excludes: [/\btransaksi\b/, /\btransactions?\b/, /\bchanges? in equity\b/] },
  { requirementId: "SHARES_ISSUED_REPORTED", statement: "BALANCE_SHEET", aliases: [/\bmodal ditempatkan dan disetor penuh\b/, /\bissued and fully paid\b/], special: "SHARES_ISSUED" },
  { requirementId: "WEIGHTED_AVG_SHARES_REPORTED", statement: "NOTE", aliases: [/\bjumlah rata rata tertimbang saham\b/, /\bweighted average number of shares\b/] },
  { requirementId: "EPS_BASIC_REPORTED", statement: "NOTE", aliases: [/\blaba per saham dasar\b/, /\bbasic earnings per share\b/] },
  { requirementId: "OCF_REPORTED", statement: "CASH_FLOW", aliases: [/\bkas neto yang diperoleh.*aktivitas operasi\b/, /\bnet cash provided.*operating.*activities\b/, /\bnet cash from operating activities\b/] },
  { requirementId: "ICF_REPORTED", statement: "CASH_FLOW", aliases: [/\bkas neto yang digunakan.*aktivitas investasi\b/, /\bnet cash used.*investing activities\b/, /\bnet cash from investing activities\b/] },
  { requirementId: "CFF_REPORTED", statement: "CASH_FLOW", aliases: [/\bkas neto yang digunakan.*aktivitas p?endanaan\b/, /\bnet cash used.*f?inancing.*activities\b/, /\bnet cash from financing activities\b/] },
  { requirementId: "NET_CHANGE_CASH_REPORTED", statement: "CASH_FLOW", aliases: [/\bkenaikan neto kas da n setara kas\b/, /\bkenaikan neto kas dan setara kas\b/, /\bnet increase in cash and cash equivalents\b/, /\bnet change in cash and cash equivalents\b/] },
  { requirementId: "FX_EFFECT_CASH_REPORTED", statement: "CASH_FLOW", aliases: [/\bdampak neto perubahan nilai tukar.*kas dan setara kas\b/, /\bnet effect of changes in exchange rates.*cash equivalents\b/] },
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[−–—]/g, "-").replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").replace(/\s+/g, " ").trim();
}

function layoutRows(page: P0AIndexedPage): LayoutRow[] {
  const grouped: Array<{ y: number; tokens: P0APageToken[] }> = [];
  for (const token of page.tokens) {
    let group = grouped.find((candidate) => Math.abs(candidate.y - token.y) <= 1.75);
    if (!group) {
      group = { y: token.y, tokens: [] };
      grouped.push(group);
    }
    group.tokens.push(token);
  }
  return grouped.sort((left, right) => right.y - left.y).map((group, rowIndex) => {
    const tokens = [...group.tokens].sort((left, right) => left.x - right.x);
    const text = tokens.map((token) => token.text).join(" ").replace(/\s+/g, " ").trim();
    return { rowIndex, y: group.y, tokens, text, normalized: normalize(text) };
  });
}

function isNumericPiece(text: string): boolean {
  return /^[\s\d.,()%+\-−–—]+$/.test(text) && /[\d()\-−–—]/.test(text);
}

function numericRuns(row: LayoutRow): NumericRun[] {
  const candidates: P0APageToken[][] = [];
  for (const token of row.tokens) {
    if (!isNumericPiece(token.text)) continue;
    const last = candidates.at(-1);
    const previous = last?.at(-1);
    const gap = previous ? token.x - (previous.x + previous.width) : Number.POSITIVE_INFINITY;
    if (last && gap <= 9) last.push(token);
    else candidates.push([token]);
  }
  return candidates.flatMap((tokens) => {
    const raw = tokens.map((token) => token.text).join(" ").trim();
    const parsed = parseFinancialDecimal(raw);
    if (!parsed) return [];
    const x1 = tokens[0].x;
    const x2 = Math.max(...tokens.map((token) => token.x + token.width));
    return [{ raw, decimal: parsed.decimal, zero: parsed.zero, x1, x2, center: (x1 + x2) / 2, tokens }];
  });
}

function periodColumns(page: P0AIndexedPage, rows: readonly LayoutRow[], context: P0AIssuerContext): PeriodColumns | null {
  const currentYear = context.periodEnd.slice(0, 4);
  const candidates: Array<{ current: P0APageToken; comparative: P0APageToken; y: number }> = [];
  for (const row of rows) {
    const dated = row.tokens.filter((token) => /\b(?:19|20)\d{2}\b/.test(token.text));
    const current = dated.filter((token) => token.text.includes(currentYear));
    const comparative = dated.filter((token) => !token.text.includes(currentYear));
    for (const left of current) for (const right of comparative) {
      if (Math.min(left.x, right.x) < page.width * 0.28) continue;
      candidates.push({ current: left, comparative: right, y: row.y });
    }
  }
  const selected = candidates.sort((left, right) => Math.abs(left.current.x - left.comparative.x) - Math.abs(right.current.x - right.comparative.x) || right.y - left.y)[0];
  if (!selected) return null;
  const currentCenter = selected.current.x + selected.current.width / 2;
  const comparativeCenter = selected.comparative.x + selected.comparative.width / 2;
  return {
    currentCenter,
    comparativeCenter,
    boundary: (currentCenter + comparativeCenter) / 2,
    currentOnLeft: currentCenter < comparativeCenter,
    confidence: 1,
  };
}

function selectCurrentRun(row: LayoutRow, columns: PeriodColumns): NumericRun | null {
  const distance = Math.abs(columns.comparativeCenter - columns.currentCenter);
  const lower = columns.currentOnLeft ? columns.currentCenter - distance * 0.72 : columns.boundary;
  const upper = columns.currentOnLeft ? columns.boundary : columns.currentCenter + distance * 0.72;
  const runs = numericRuns(row).filter((run) => run.center >= lower && run.center <= upper);
  return runs.sort((left, right) => Math.abs(left.center - columns.currentCenter) - Math.abs(right.center - columns.currentCenter))[0] ?? null;
}

function labelForRow(row: LayoutRow, columns: PeriodColumns): string {
  const distance = Math.abs(columns.comparativeCenter - columns.currentCenter);
  const tableLeft = Math.min(columns.currentCenter, columns.comparativeCenter) - distance * 0.72;
  const tableRight = Math.max(columns.currentCenter, columns.comparativeCenter) + distance * 0.72;
  return row.tokens.filter((token) => {
    const center = token.x + token.width / 2;
    return center < tableLeft || center > tableRight || !isNumericPiece(token.text);
  }).map((token) => token.text).join(" ").replace(/\s+/g, " ").trim();
}

function logicalRows(page: P0AIndexedPage, context: P0AIssuerContext): LogicalRow[] {
  const rows = layoutRows(page);
  const columns = periodColumns(page, rows, context);
  if (!columns) return [];
  const logical: LogicalRow[] = [];
  const pending: string[] = [];
  for (const row of rows) {
    const label = labelForRow(row, columns);
    const current = selectCurrentRun(row, columns);
    if (!current) {
      if (label) pending.push(label);
      if (pending.length > 5) pending.shift();
      continue;
    }
    const combined = [...pending, label].filter(Boolean).join(" ");
    logical.push({ row, label: combined, normalizedLabel: normalize(combined), current, columns });
    pending.length = 0;
  }
  return logical;
}

function sourceSnippet(page: P0AIndexedPage, anchors: readonly string[]): string {
  for (const anchor of anchors) {
    const at = page.text.indexOf(anchor);
    if (at >= 0) return page.text.slice(Math.max(0, at - 140), Math.min(page.text.length, at + anchor.length + 140));
  }
  throw new Error(`Native evidence anchor was not found on PDF page ${page.pageNumber}.`);
}

function scope(page: P0AIndexedPage, context: P0AIssuerContext): P0ANativeObservation["consolidationScope"] {
  if (/\b(?:consolidated|konsolidasian)\b/i.test(page.text)) return "CONSOLIDATED";
  if (context.consolidated === false) return "STANDALONE";
  return "UNKNOWN";
}

function documentScale(page: P0AIndexedPage, context: P0AIssuerContext): string {
  if (/\b(?:jutaan|millions?)\b/i.test(page.text)) return "1000000";
  if (/\b(?:ribuan|thousands?)\b/i.test(page.text)) return "1000";
  return context.documentScale;
}

function evidenceFor(input: { requirementId: string; page: P0AIndexedPage; row: LogicalRow; rawValue?: string; rowLabel?: string }): P0AEvidence {
  const rawValue = input.rawValue ?? input.row.current.raw;
  const anchors = [rawValue, ...input.row.current.tokens.map((token) => token.text)].filter(Boolean);
  return {
    ...createEvidence({
      requirementId: input.requirementId,
      page: input.page,
      statement: input.requirementId.startsWith("OCF_") || input.requirementId.startsWith("ICF_") || input.requirementId.startsWith("CFF_") || input.requirementId.startsWith("NET_CHANGE_CASH_") || input.requirementId.startsWith("FX_EFFECT_CASH_")
        ? "CASH_FLOW"
        : input.requirementId.startsWith("REV_") || input.requirementId.startsWith("COGS_") || input.requirementId.includes("PROFIT") || input.requirementId.startsWith("FINANCE_") || input.requirementId.startsWith("PRETAX_") || input.requirementId.startsWith("TAX_") || input.requirementId.startsWith("EPS_") || input.requirementId.startsWith("WEIGHTED_")
          ? "INCOME_STATEMENT"
          : "BALANCE_SHEET",
      table: null,
      rowLabel: input.rowLabel ?? input.row.label,
      columnLabel: input.row.columns.currentOnLeft ? "CURRENT_PERIOD_LEFT_COLUMN" : "CURRENT_PERIOD_RIGHT_COLUMN",
      rawValue,
      snippet: sourceSnippet(input.page, anchors),
    }),
    rowIndex: input.row.row.rowIndex,
    columnIndex: input.row.columns.currentOnLeft ? 0 : 1,
  };
}

function metadata(input: { requirementId: string; page: P0AIndexedPage; context: P0AIssuerContext; statement: P0AStatementType; rawLabel: string; mappingConfidence: number }): Pick<P0ANativeObservation, "rawLabel" | "statement" | "period" | "consolidationScope" | "readConfidence" | "mappingConfidence" | "versions"> {
  const requirement = P0A_REQUIREMENT_BY_ID.get(input.requirementId);
  if (!requirement) throw new Error(`Unknown frozen P0-A requirement: ${input.requirementId}`);
  return {
    rawLabel: input.rawLabel,
    statement: input.statement,
    period: { start: input.context.periodStart, end: input.context.periodEnd, type: input.context.periodType, nature: requirement.periodNature },
    consolidationScope: scope(input.page, input.context),
    readConfidence: 1,
    mappingConfidence: input.mappingConfidence,
    versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
  };
}

function sharesFromLabel(label: string): { raw: string; decimal: string } | null {
  const normalized = label.normalize("NFKC");
  const matches = [...normalized.matchAll(/(?:issued and fully paid|ditempatkan dan disetor\s+penuh)\s*-?\s*([\d][\d.,\s]{5,}?)\s*(?:shares|saham)/gi)];
  for (const match of matches) {
    const parsed = parseFinancialDecimal(match[1]);
    if (parsed && new Prisma.Decimal(parsed.decimal).greaterThanOrEqualTo("1000000")) return { raw: match[1].trim(), decimal: parsed.decimal };
  }
  return null;
}

function directCandidates(rule: NativeRule, page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation[] {
  const requirement = P0A_REQUIREMENT_BY_ID.get(rule.requirementId);
  if (!requirement) return [];
  const candidates: P0ANativeObservation[] = [];
  for (const row of logicalRows(page, context)) {
    if (!rule.aliases.some((alias) => alias.test(row.normalizedLabel))) continue;
    if (rule.excludes?.some((exclude) => exclude.test(row.normalizedLabel))) continue;
    let decimal = row.current.decimal;
    let rawValue = row.current.raw;
    let evidence = evidenceFor({ requirementId: rule.requirementId, page, row });
    if (rule.special === "SHARES_ISSUED") {
      const shares = sharesFromLabel(row.label) ?? sharesFromLabel(page.text);
      if (!shares) continue;
      decimal = shares.decimal;
      rawValue = shares.raw;
      evidence = evidenceFor({ requirementId: rule.requirementId, page, row, rawValue, rowLabel: row.label });
    }
    const scale = requirement.unitType === "DOCUMENT_CURRENCY" ? documentScale(page, context) : "1";
    candidates.push({
      requirementId: rule.requirementId,
      origin: "REPORTED",
      state: decimal === "0" ? "ZERO" : "VALUE",
      decimalValue: decimal,
      rawValue,
      currency: requirement.unitType === "SHARES" ? "SHARES" : requirement.unitType === "PER_SHARE" ? `${context.currency}_PER_SHARE` : context.currency,
      unitType: requirement.unitType,
      scale,
      evidence: [evidence],
      ...metadata({ requirementId: rule.requirementId, page, context, statement: rule.statement, rawLabel: row.label, mappingConfidence: rule.mappingConfidence ?? 0.99 }),
    });
  }
  return candidates;
}

function nonApplicableDiluted(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "NOTE") return null;
  const match = page.text.match(/(?:tidak mempunyai efek berpotensi[\s\S]{0,350}?laba per saham dilusian tidak dihitung dan disajikan|no outstanding potential dilutive[\s\S]{0,350}?no diluted earnings per share are calculated and presented)/i);
  if (!match) return null;
  const requirementId = "EPS_DILUTED_REPORTED";
  const snippet = sourceSnippet(page, [match[0]]);
  const evidence = createEvidence({
    requirementId, page, statement: "INCOME_STATEMENT", table: null,
    rowLabel: "Diluted earnings per share applicability", columnLabel: context.periodEnd,
    rawValue: match[0], snippet,
  });
  return {
    requirementId, origin: "REPORTED", state: "NOT_APPLICABLE", decimalValue: null,
    rawValue: match[0], currency: `${context.currency}_PER_SHARE`, unitType: "PER_SHARE", scale: "1", evidence: [evidence],
    ...metadata({ requirementId, page, context, statement: "NOTE", rawLabel: match[0], mappingConfidence: 1 }),
  };
}

function resolveCandidates(requirementId: string, candidates: readonly P0ANativeObservation[]): P0ANativeObservation[] {
  if (candidates.length <= 1) return [...candidates];
  const values = new Set(candidates.map((candidate) => `${candidate.state}:${candidate.decimalValue}`));
  if (values.size === 1) return [[...candidates].sort((left, right) => right.mappingConfidence - left.mappingConfidence || left.evidence[0].pageNumber - right.evidence[0].pageNumber)[0]];
  const first = candidates[0];
  return [{
    ...first,
    state: "CONFLICT",
    decimalValue: null,
    rawValue: candidates.map((candidate) => candidate.rawValue).join(" | "),
    evidence: candidates.flatMap((candidate) => candidate.evidence),
    readConfidence: Math.min(...candidates.map((candidate) => candidate.readConfidence)),
  }];
}

function aggregateObservation(input: { requirementId: string; components: readonly { page: P0ARoutedPage; row: LogicalRow; id: string }[]; context: P0AIssuerContext }): P0ANativeObservation | null {
  if (input.components.length < 2) return null;
  const requirement = P0A_REQUIREMENT_BY_ID.get(input.requirementId);
  if (!requirement) return null;
  const decimal = sumFinancialDecimals(input.components.map((component) => component.row.current.decimal));
  const first = input.components[0];
  return {
    requirementId: input.requirementId,
    origin: "STANDARDIZED_AGGREGATE",
    state: decimal === "0" ? "ZERO" : "VALUE",
    decimalValue: decimal,
    rawValue: input.components.map((component) => component.row.current.raw).join(" + "),
    currency: input.context.currency,
    unitType: requirement.unitType,
    scale: documentScale(first.page, input.context),
    evidence: input.components.map((component) => evidenceFor({ requirementId: input.requirementId, page: component.page, row: component.row, rowLabel: component.row.label })),
    sourceFactIds: input.components.map((component) => component.id),
    ...metadata({ requirementId: input.requirementId, page: first.page, context: input.context, statement: requirement.statementType, rawLabel: input.components.map((component) => component.row.label).join(" | "), mappingConfidence: 0.98 }),
  };
}

/**
 * Finds component rows using document hierarchy and emits only a separately
 * labelled STANDARDIZED_AGGREGATE. It never promotes a component sum to a
 * reported scalar.
 */
function componentAggregates(task: P0APlanTask, pages: readonly P0ARoutedPage[], context: P0AIssuerContext): P0ANativeObservation[] {
  const wanted = new Set(task.requirementIds);
  const buckets = new Map<string, Array<{ page: P0ARoutedPage; row: LogicalRow; id: string }>>();
  const add = (id: string, page: P0ARoutedPage, row: LogicalRow, ordinal: number) => buckets.set(id, [...(buckets.get(id) ?? []), { page, row, id: `${id}:component:${page.pageNumber}:${ordinal}` }]);

  for (const page of pages.filter((candidate) => candidate.statementType === "BALANCE_SHEET")) {
    const rows = logicalRows(page, context);
    let receivableTrade = false;
    let payableTrade = false;
    let longDebtBlock = false;
    for (const [ordinal, row] of rows.entries()) {
      const label = row.normalizedLabel;
      if (/\bpiutang\b.*\baccounts receivable\b/.test(label)) receivableTrade = /\busaha\b|\btrade\b/.test(label);
      if (/\bbukan usaha\b|\bnon trade\b/.test(label)) receivableTrade = false;
      if (receivableTrade && /\bpihak ketiga\b|\bpihak berelasi\b|\bthird parties\b|\brelated parties\b/.test(label)) add("AR_REPORTED", page, row, ordinal);

      if (/\butang\b.*\baccounts payable\b/.test(label)) payableTrade = /\busaha\b|\btrade\b/.test(label);
      if (/\bbukan usaha\b|\bnon trade\b/.test(label)) payableTrade = false;
      if (payableTrade && /\bpihak ketiga\b|\bpihak berelasi\b|\bthird parties\b|\brelated parties\b/.test(label)) add("AP_REPORTED", page, row, ordinal);

      if (/\butang bank jangka .*pendek\b|\bshort term bank\b/.test(label)) add("SHORT_TERM_DEBT_REPORTED", page, row, ordinal);
      if (/\bjatuh tempo.*satu tahun\b.*\butang bank\b|\bcurrent maturities.*long term debts\b.*\bbank loans?\b/.test(label)) add("SHORT_TERM_DEBT_REPORTED", page, row, ordinal);

      if (/\butang jangka panjang setelah\b|\blong term debts net of current maturities\b/.test(label)) longDebtBlock = true;
      if (longDebtBlock && /\bliabilitas sewa\b|\blease liabilities\b/.test(label)) longDebtBlock = false;
      if (longDebtBlock && /\butang bank\b|\bbank loans?\b|\butang obligasi\b|\bbonds payable\b|\butang jangka panjang lainnya\b|\bother long term debt\b/.test(label)) add("LONG_TERM_DEBT_REPORTED", page, row, ordinal);
    }
  }
  return [...buckets.entries()].flatMap(([requirementId, components]) => {
    if (!wanted.has(requirementId)) return [];
    const observation = aggregateObservation({ requirementId, components, context });
    return observation ? [observation] : [];
  });
}

export function createNativeFinancialExtractor(input: { routedPages: readonly P0ARoutedPage[]; context: P0AIssuerContext }) {
  const routedByNumber = new Map(input.routedPages.map((page) => [page.pageNumber, page]));
  return async (task: P0APlanTask, indexedPages: readonly P0AIndexedPage[]): Promise<P0ANativeObservation[]> => {
    const selected = task.selectedPages.map((pageNumber) => routedByNumber.get(pageNumber) ?? indexedPages.find((page) => page.pageNumber === pageNumber)).filter((page): page is P0ARoutedPage => Boolean(page));
    const required = new Set(task.requirementIds);
    const found = new Map<string, P0ANativeObservation[]>();
    for (const rule of RULES) {
      if (!required.has(rule.requirementId)) continue;
      for (const page of selected) {
        const statementMatches = rule.statement === "NOTE" ? page.statementType === "NOTE" : page.statementType === rule.statement;
        if (!statementMatches) continue;
        found.set(rule.requirementId, [...(found.get(rule.requirementId) ?? []), ...directCandidates(rule, page, input.context)]);
      }
    }
    if (required.has("EPS_DILUTED_REPORTED")) {
      for (const page of selected) {
        const observation = nonApplicableDiluted(page, input.context);
        if (observation) found.set(observation.requirementId, [...(found.get(observation.requirementId) ?? []), observation]);
      }
    }
    const direct = [...found.entries()].flatMap(([requirementId, candidates]) => resolveCandidates(requirementId, candidates));
    return [...direct, ...componentAggregates(task, selected, input.context)];
  };
}
