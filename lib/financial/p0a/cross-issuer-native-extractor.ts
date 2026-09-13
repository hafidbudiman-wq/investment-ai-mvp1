import { Prisma } from "@prisma/client";
import { createEvidence } from "@/lib/financial/p0a/evidence";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { createNativeFinancialExtractor } from "@/lib/financial/p0a/native-extractor";
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
type NumericRun = { raw: string; decimal: string; center: number; tokens: P0APageToken[] };
type PeriodColumns = { currentCenter: number; comparativeCenter: number; boundary: number; currentOnLeft: boolean };
type LogicalRow = { row: LayoutRow; label: string; normalizedLabel: string; current: NumericRun; columns: PeriodColumns };
type SupplementalRule = { requirementId: string; statement: P0AStatementType; aliases: readonly RegExp[]; excludes?: readonly RegExp[] };

/* Generic PSAK/IFRS presentation aliases only: no issuer, page, or known-value predicates. */
const SUPPLEMENTAL_RULES: readonly SupplementalRule[] = [
  { requirementId: "REV_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\bjumlah pendapatan\b/, /\btotal revenues?\b/] },
  { requirementId: "COGS_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\bjumlah beban pokok pendapatan(?: dan biaya langsung lainnya)?\b/, /\btotal cost of revenues?(?: and other direct costs)?\b/] },
  { requirementId: "GROSS_PROFIT_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\blaba kotor\b/] },
  { requirementId: "PRETAX_PROFIT_REPORTED", statement: "INCOME_STATEMENT", aliases: [/\blaba sebelum pajak penghasilan\b/, /\bincome before tax expense\b/] },
  {
    requirementId: "NET_PROFIT_REPORTED", statement: "INCOME_STATEMENT",
    aliases: [/\blaba periode tahun berjalan\b/, /\bprofit for the period year\b/],
    excludes: [/\bcontinuing operations?\b/, /\bdiscontinued operations?\b/, /\boperasi yang dilanjutkan\b/, /\boperasi yang dihentikan\b/, /\bcomprehensive\b/, /\bkomprehensif\b/, /\battribut/],
  },
  {
    requirementId: "NET_PROFIT_PARENT_REPORTED", statement: "INCOME_STATEMENT",
    aliases: [/\blaba periode tahun berjalan yang diatribusikan kepada pemilik entitas induk\b/, /\bprofit for the period year attributable to equity holders? of the parent(?: company| entity)?\b/],
    excludes: [/\bcontinuing operations?\b/, /\bdiscontinued operations?\b/, /\boperasi yang dilanjutkan\b/, /\boperasi yang dihentikan\b/, /\bcomprehensive\b/, /\bkomprehensif\b/],
  },
  {
    requirementId: "EPS_BASIC_REPORTED", statement: "INCOME_STATEMENT",
    aliases: [/\blaba per saham dasar yang dapat diatribusikan kepada pemilik entitas induk\b/, /\bbasic earnings per share attributable to equity holders? of the parent\b/],
    excludes: [/\bcontinuing operations?\b/, /\bdiscontinued operations?\b/, /\boperasi yang dilanjutkan\b/, /\boperasi yang dihentikan\b/],
  },
  { requirementId: "INV_REPORTED", statement: "BALANCE_SHEET", aliases: [/\bpersediaan\b/, /\binventories\b/] },
  { requirementId: "PPE_REPORTED", statement: "BALANCE_SHEET", aliases: [/\baset tetap\b/, /\bproperty plant and equipment\b/] },
  { requirementId: "EQUITY_PARENT_REPORTED", statement: "BALANCE_SHEET", aliases: [/\btotal ekuitas yang dapat diatribusikan kepada pemilik entitas induk\b/, /\btotal equity attributable to (?:the )?equity holders? of the parent (?:company|entity)\b/] },
  { requirementId: "OCF_REPORTED", statement: "CASH_FLOW", aliases: [/\bkas neto (?:yang )?diperoleh.*aktivitas operasi\b/, /\bnet cash (?:provided by|from|used in) operating activities\b/] },
  { requirementId: "ICF_REPORTED", statement: "CASH_FLOW", aliases: [/\bkas neto (?:yang )?digunakan.*aktivitas investasi\b/, /\bnet cash (?:used in|from) investing activities\b/] },
  { requirementId: "CFF_REPORTED", statement: "CASH_FLOW", aliases: [/\bkas neto (?:yang )?digunakan.*aktivitas pendanaan\b/, /\bnet cash (?:used in|from) financing activities\b/] },
  { requirementId: "FX_EFFECT_CASH_REPORTED", statement: "CASH_FLOW", aliases: [/\bperbedaan nilai tukar neto\b/, /\bnet foreign exchange difference\b/] },
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[−–—]/g, "-").replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").replace(/\s+/g, " ").trim();
}

function layoutRows(page: P0AIndexedPage): LayoutRow[] {
  const grouped: Array<{ y: number; tokens: P0APageToken[] }> = [];
  for (const token of page.tokens) {
    let group = grouped.find((candidate) => Math.abs(candidate.y - token.y) <= 1.75);
    if (!group) { group = { y: token.y, tokens: [] }; grouped.push(group); }
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
  const groups: P0APageToken[][] = [];
  for (const token of row.tokens) {
    if (!isNumericPiece(token.text)) continue;
    const last = groups.at(-1);
    const previous = last?.at(-1);
    const gap = previous ? token.x - (previous.x + previous.width) : Number.POSITIVE_INFINITY;
    if (last && gap <= 9) last.push(token); else groups.push([token]);
  }
  return groups.flatMap((tokens) => {
    const raw = tokens.map((token) => token.text).join(" ").trim();
    const parsed = parseFinancialDecimal(raw);
    if (!parsed) return [];
    const x1 = tokens[0].x;
    const x2 = Math.max(...tokens.map((token) => token.x + token.width));
    return [{ raw, decimal: parsed.decimal, center: (x1 + x2) / 2, tokens }];
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
  return { currentCenter, comparativeCenter, boundary: (currentCenter + comparativeCenter) / 2, currentOnLeft: currentCenter < comparativeCenter };
}

function selectCurrentRun(row: LayoutRow, columns: PeriodColumns): NumericRun | null {
  const distance = Math.abs(columns.comparativeCenter - columns.currentCenter);
  const lower = columns.currentOnLeft ? columns.currentCenter - distance * 0.72 : columns.boundary;
  const upper = columns.currentOnLeft ? columns.boundary : columns.currentCenter + distance * 0.72;
  return numericRuns(row).filter((run) => run.center >= lower && run.center <= upper)
    .sort((left, right) => Math.abs(left.center - columns.currentCenter) - Math.abs(right.center - columns.currentCenter))[0] ?? null;
}

function labelForRow(row: LayoutRow, columns: PeriodColumns): string {
  const distance = Math.abs(columns.comparativeCenter - columns.currentCenter);
  const left = Math.min(columns.currentCenter, columns.comparativeCenter) - distance * 0.72;
  const right = Math.max(columns.currentCenter, columns.comparativeCenter) + distance * 0.72;
  return row.tokens.filter((token) => {
    const center = token.x + token.width / 2;
    return center < left || center > right || !isNumericPiece(token.text);
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
    if (at >= 0) return page.text.slice(Math.max(0, at - 160), Math.min(page.text.length, at + anchor.length + 160));
  }
  return page.text.slice(0, 320);
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

function metadata(input: { requirementId: string; page: P0AIndexedPage; context: P0AIssuerContext; statement: P0AStatementType; rawLabel: string; mappingConfidence?: number }): Pick<P0ANativeObservation, "rawLabel" | "statement" | "period" | "consolidationScope" | "readConfidence" | "mappingConfidence" | "versions"> {
  const requirement = P0A_REQUIREMENT_BY_ID.get(input.requirementId);
  if (!requirement) throw new Error(`Unknown frozen P0-A requirement: ${input.requirementId}`);
  return {
    rawLabel: input.rawLabel,
    statement: input.statement,
    period: { start: input.context.periodStart, end: input.context.periodEnd, type: input.context.periodType, nature: requirement.periodNature },
    consolidationScope: scope(input.page, input.context),
    readConfidence: 1,
    mappingConfidence: input.mappingConfidence ?? 0.99,
    versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
  };
}

function evidenceForLogical(requirementId: string, page: P0AIndexedPage, row: LogicalRow): P0AEvidence {
  return {
    ...createEvidence({ requirementId, page, statement: P0A_REQUIREMENT_BY_ID.get(requirementId)?.statementType ?? "OTHER", table: null, rowLabel: row.label, columnLabel: row.columns.currentOnLeft ? "CURRENT_PERIOD_LEFT_COLUMN" : "CURRENT_PERIOD_RIGHT_COLUMN", rawValue: row.current.raw, snippet: sourceSnippet(page, [row.current.raw, row.label]) }),
    rowIndex: row.row.rowIndex,
    columnIndex: row.columns.currentOnLeft ? 0 : 1,
  };
}

function directSupplement(rule: SupplementalRule, page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation[] {
  const requirement = P0A_REQUIREMENT_BY_ID.get(rule.requirementId);
  if (!requirement) return [];
  return logicalRows(page, context).flatMap((row) => {
    if (!rule.aliases.some((alias) => alias.test(row.normalizedLabel))) return [];
    if (rule.excludes?.some((exclude) => exclude.test(row.normalizedLabel))) return [];
    return [{
      requirementId: rule.requirementId,
      origin: "REPORTED" as const,
      state: row.current.decimal === "0" ? "ZERO" as const : "VALUE" as const,
      decimalValue: row.current.decimal,
      rawValue: row.current.raw,
      currency: requirement.unitType === "SHARES" ? "SHARES" : requirement.unitType === "PER_SHARE" ? `${context.currency}_PER_SHARE` : context.currency,
      unitType: requirement.unitType,
      scale: requirement.unitType === "DOCUMENT_CURRENCY" ? documentScale(page, context) : "1",
      evidence: [evidenceForLogical(rule.requirementId, page, row)],
      ...metadata({ requirementId: rule.requirementId, page, context, statement: rule.statement, rawLabel: row.label }),
    }];
  });
}

function resolve(requirementId: string, candidates: readonly P0ANativeObservation[]): P0ANativeObservation[] {
  if (candidates.length <= 1) return [...candidates];
  const values = new Set(candidates.map((candidate) => `${candidate.state}:${candidate.decimalValue}`));
  if (values.size === 1) return [[...candidates].sort((a, b) => a.evidence[0].pageNumber - b.evidence[0].pageNumber)[0]];
  const first = candidates[0];
  return [{ ...first, state: "CONFLICT", decimalValue: null, rawValue: candidates.map((candidate) => candidate.rawValue).join(" | "), evidence: candidates.flatMap((candidate) => candidate.evidence) }];
}

function simpleEvidence(input: { requirementId: string; page: P0AIndexedPage; row: LayoutRow; rawValue: string; columnLabel: string }): P0AEvidence {
  return {
    ...createEvidence({ requirementId: input.requirementId, page: input.page, statement: P0A_REQUIREMENT_BY_ID.get(input.requirementId)?.statementType ?? "OTHER", table: null, rowLabel: input.row.text, columnLabel: input.columnLabel, rawValue: input.rawValue, snippet: sourceSnippet(input.page, [input.rawValue, input.row.text]) }),
    rowIndex: input.row.rowIndex,
  };
}

function precedingYear(rows: readonly LayoutRow[], rowIndex: number): string | null {
  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    const years = rows[index].text.match(/\b(?:19|20)\d{2}\b/g);
    if (years?.length) return years[0];
  }
  return null;
}

function weightedAverageShares(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "NOTE") return null;
  const rows = layoutRows(page);
  const currentYear = context.periodEnd.slice(0, 4);
  for (const [index, row] of rows.entries()) {
    if (!/\b(?:laba per saham dasar|basic earnings per share)\b/.test(row.normalized)) continue;
    if (precedingYear(rows, index) !== currentYear) continue;
    const runs = numericRuns(row).filter((run) => new Prisma.Decimal(run.decimal).abs().greaterThanOrEqualTo("1000000"));
    if (!runs.length) continue;
    const selected = [...runs].sort((a, b) => new Prisma.Decimal(b.decimal).abs().comparedTo(new Prisma.Decimal(a.decimal).abs()))[0];
    return {
      requirementId: "WEIGHTED_AVG_SHARES_REPORTED", origin: "REPORTED", state: selected.decimal === "0" ? "ZERO" : "VALUE",
      decimalValue: selected.decimal, rawValue: selected.raw, currency: "SHARES", unitType: "SHARES", scale: "1",
      evidence: [simpleEvidence({ requirementId: "WEIGHTED_AVG_SHARES_REPORTED", page, row, rawValue: selected.raw, columnLabel: context.periodEnd })],
      ...metadata({ requirementId: "WEIGHTED_AVG_SHARES_REPORTED", page, context, statement: "NOTE", rawLabel: row.text, mappingConfidence: 0.995 }),
    };
  }
  return null;
}

function treasuryShares(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "NOTE") return null;
  const candidates: Array<{ row: LayoutRow; run: NumericRun }> = [];
  for (const row of layoutRows(page)) {
    if (!/\b(?:saham treasuri|treasury (?:shares|stock))\b/.test(row.normalized)) continue;
    for (const run of numericRuns(row)) if (new Prisma.Decimal(run.decimal).abs().greaterThanOrEqualTo("1000000")) candidates.push({ row, run });
  }
  if (!candidates.length) return null;
  const selected = candidates.sort((a, b) => new Prisma.Decimal(b.run.decimal).abs().comparedTo(new Prisma.Decimal(a.run.decimal).abs()))[0];
  return {
    requirementId: "TREASURY_SHARES_REPORTED", origin: "REPORTED", state: selected.run.decimal === "0" ? "ZERO" : "VALUE",
    decimalValue: selected.run.decimal, rawValue: selected.run.raw, currency: "SHARES", unitType: "SHARES", scale: "1",
    evidence: [simpleEvidence({ requirementId: "TREASURY_SHARES_REPORTED", page, row: selected.row, rawValue: selected.run.raw, columnLabel: context.periodEnd })],
    ...metadata({ requirementId: "TREASURY_SHARES_REPORTED", page, context, statement: "NOTE", rawLabel: selected.row.text, mappingConfidence: 0.995 }),
  };
}

function dilutedNotApplicable(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "NOTE") return null;
  const match = page.text.match(/(?:tidak\s+(?:menghitung|menyajikan)[\s\S]{0,280}?laba per saham dilusian[\s\S]{0,280}?(?:tidak terdapat|tidak mempunyai)[\s\S]{0,180}?(?:berpotensi dilutif|potensial dilutif)|did not calculate diluted earnings per share[\s\S]{0,280}?no potentially dilutive ordinary shares)/i);
  if (!match) return null;
  const evidence = createEvidence({ requirementId: "EPS_DILUTED_REPORTED", page, statement: "INCOME_STATEMENT", table: null, rowLabel: "Diluted earnings per share applicability", columnLabel: context.periodEnd, rawValue: match[0], snippet: sourceSnippet(page, [match[0]]) });
  return {
    requirementId: "EPS_DILUTED_REPORTED", origin: "REPORTED", state: "NOT_APPLICABLE", decimalValue: null, rawValue: match[0],
    currency: `${context.currency}_PER_SHARE`, unitType: "PER_SHARE", scale: "1", evidence: [evidence],
    ...metadata({ requirementId: "EPS_DILUTED_REPORTED", page, context, statement: "NOTE", rawLabel: match[0], mappingConfidence: 1 }),
  };
}

function debtAlternative(page: P0ARoutedPage, context: P0AIssuerContext, requirementId: "SHORT_TERM_DEBT_REPORTED" | "LONG_TERM_DEBT_REPORTED"): P0ANativeObservation | null {
  if (page.statementType !== "BALANCE_SHEET") return null;
  const selected: LogicalRow[] = [];
  let currentMaturityBlock = false;
  let nonCurrentBlock = false;
  for (const row of logicalRows(page, context)) {
    const label = row.normalizedLabel;
    if (/\b(?:current maturities of long term|jatuh tempo dalam satu tahun)\b/.test(label)) currentMaturityBlock = true;
    if (/\b(?:long term liabilities net of current maturities|liabilitas jangka panjang setelah dikurangi)\b/.test(label)) nonCurrentBlock = true;
    if (/\b(?:lease liabilities|liabilitas sewa)\b/.test(label)) continue;
    if (/\b(?:total current liabilities|jumlah liabilitas jangka pendek)\b/.test(label)) currentMaturityBlock = false;
    if (/\b(?:total non current liabilities|jumlah liabilitas jangka panjang)\b/.test(label)) nonCurrentBlock = false;
    if (requirementId === "SHORT_TERM_DEBT_REPORTED") {
      const shortStandalone = /\b(?:short term bank loans?|pinjaman bank jangka pendek)\b/.test(label);
      const currentDebtChild = currentMaturityBlock && /\b(?:bank loans?|pinjaman bank|non bank financial|instansi keuangan non bank|bonds?|obligasi)\b/.test(label);
      if (shortStandalone || currentDebtChild) selected.push(row);
    } else {
      const nonCurrentDebtChild = nonCurrentBlock && /\b(?:bank loans?|pinjaman bank|non bank financial|instansi keuangan non bank|bonds?|obligasi)\b/.test(label);
      if (nonCurrentDebtChild) selected.push(row);
    }
  }
  if (!selected.length) return null;
  const total = selected.reduce((sum, row) => sum.plus(new Prisma.Decimal(row.current.decimal)), new Prisma.Decimal(0));
  const requirement = P0A_REQUIREMENT_BY_ID.get(requirementId)!;
  return {
    requirementId, origin: "STANDARDIZED_AGGREGATE", state: total.isZero() ? "ZERO" : "VALUE", decimalValue: total.toFixed(),
    rawValue: selected.map((row) => row.current.raw).join(" + "), currency: context.currency, unitType: requirement.unitType,
    scale: documentScale(page, context), evidence: selected.map((row) => evidenceForLogical(requirementId, page, row)),
    sourceFactIds: selected.map((row) => `${page.pageNumber}:${row.row.rowIndex}`),
    ...metadata({ requirementId, page, context, statement: "BALANCE_SHEET", rawLabel: selected.map((row) => row.label).join(" | "), mappingConfidence: 0.97 }),
  };
}

function unsafeBaseObservation(observation: P0ANativeObservation): boolean {
  const label = normalize(observation.rawLabel ?? observation.rawValue ?? "");
  if (observation.requirementId === "NET_CHANGE_CASH_REPORTED" && /\b(?:continuing|discontinued) operations?\b|\boperasi yang (?:dilanjutkan|dihentikan)\b/.test(label)) return true;
  if (["NET_PROFIT_REPORTED", "NET_PROFIT_PARENT_REPORTED", "EPS_BASIC_REPORTED"].includes(observation.requirementId) && observation.state === "CONFLICT") return true;
  if (["SHORT_TERM_DEBT_REPORTED", "LONG_TERM_DEBT_REPORTED"].includes(observation.requirementId) && observation.origin === "STANDARDIZED_AGGREGATE") return true;
  return false;
}

/** Frozen extractor first, then issuer-agnostic cross-presentation supplements. */
export function createCrossIssuerNativeExtractor(input: { routedPages: readonly P0ARoutedPage[]; context: P0AIssuerContext }) {
  const base = createNativeFinancialExtractor(input);
  const routedByNumber = new Map(input.routedPages.map((page) => [page.pageNumber, page]));
  return async (task: P0APlanTask, indexedPages: readonly P0AIndexedPage[]): Promise<P0ANativeObservation[]> => {
    const baseObservations = (await base(task, indexedPages)).filter((observation) => !unsafeBaseObservation(observation));
    const safelyResolved = new Set(baseObservations.filter((observation) => observation.origin === "REPORTED" && ["VALUE", "ZERO", "NOT_APPLICABLE"].includes(observation.state)).map((observation) => observation.requirementId));
    const selected = task.selectedPages.map((pageNumber) => routedByNumber.get(pageNumber) ?? indexedPages.find((page) => page.pageNumber === pageNumber)).filter((page): page is P0ARoutedPage => Boolean(page));
    const candidates = new Map<string, P0ANativeObservation[]>();

    for (const rule of SUPPLEMENTAL_RULES) {
      if (!task.requirementIds.includes(rule.requirementId) || safelyResolved.has(rule.requirementId)) continue;
      for (const page of selected) {
        if (page.statementType !== rule.statement) continue;
        candidates.set(rule.requirementId, [...(candidates.get(rule.requirementId) ?? []), ...directSupplement(rule, page, input.context)]);
      }
    }

    for (const requirementId of ["SHORT_TERM_DEBT_REPORTED", "LONG_TERM_DEBT_REPORTED"] as const) {
      if (!task.requirementIds.includes(requirementId) || safelyResolved.has(requirementId)) continue;
      for (const page of selected) {
        const observation = debtAlternative(page, input.context, requirementId);
        if (observation) candidates.set(requirementId, [...(candidates.get(requirementId) ?? []), observation]);
      }
    }

    if (task.requirementIds.includes("WEIGHTED_AVG_SHARES_REPORTED") && !safelyResolved.has("WEIGHTED_AVG_SHARES_REPORTED")) {
      for (const page of selected) { const observation = weightedAverageShares(page, input.context); if (observation) candidates.set(observation.requirementId, [...(candidates.get(observation.requirementId) ?? []), observation]); }
    }
    if (task.requirementIds.includes("TREASURY_SHARES_REPORTED") && !safelyResolved.has("TREASURY_SHARES_REPORTED")) {
      for (const page of selected) { const observation = treasuryShares(page, input.context); if (observation) candidates.set(observation.requirementId, [...(candidates.get(observation.requirementId) ?? []), observation]); }
    }
    if (task.requirementIds.includes("EPS_DILUTED_REPORTED") && !safelyResolved.has("EPS_DILUTED_REPORTED")) {
      for (const page of selected) { const observation = dilutedNotApplicable(page, input.context); if (observation) candidates.set(observation.requirementId, [...(candidates.get(observation.requirementId) ?? []), observation]); }
    }

    const supplements = [...candidates.entries()].flatMap(([requirementId, values]) => resolve(requirementId, values));
    return [...baseObservations, ...supplements];
  };
}
