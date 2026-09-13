import { Prisma } from "@prisma/client";
import { createEvidence } from "@/lib/financial/p0a/evidence";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { createPhase5GenericNativeExtractor } from "@/lib/financial/p0a/phase5-generic-extractor";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type { P0AIndexedPage, P0AIssuerContext, P0ANativeObservation, P0APageToken, P0APlanTask, P0ARoutedPage } from "@/lib/financial/p0a/types";
import { P0A_NATIVE_MAPPING_VERSION, P0A_PARSER_VERSION, P0A_ROUTER_VERSION, P0A_VALIDATION_VERSION } from "@/lib/financial/p0a/versions";

type LayoutRow = { rowIndex: number; y: number; tokens: P0APageToken[]; text: string; normalized: string };
type NumericRun = { raw: string; decimal: string; center: number };
type PeriodColumns = { currentCenter: number; comparativeCenter: number; boundary: number; currentOnLeft: boolean };
type LogicalRow = { row: LayoutRow; label: string; normalizedLabel: string; current: NumericRun; columns: PeriodColumns };

type ExactRule = {
  requirementId: "EQUITY_REPORTED" | "NCI_REPORTED" | "PRETAX_PROFIT_REPORTED" | "TAX_EXPENSE_REPORTED";
  statement: "BALANCE_SHEET" | "INCOME_STATEMENT";
  aliases: readonly RegExp[];
  excludes?: readonly RegExp[];
};

const EXACT_RULES: readonly ExactRule[] = [
  {
    requirementId: "EQUITY_REPORTED",
    statement: "BALANCE_SHEET",
    aliases: [/\bjumlah ekuitas\b/, /\btotal equity\b/],
    excludes: [/\bdiatribusikan\b/, /\battributable\b/, /\bliabilit(?:as|ies)\b/],
  },
  {
    requirementId: "NCI_REPORTED",
    statement: "BALANCE_SHEET",
    aliases: [/\bkepentingan nonpengendali\b/, /\bnon controlling interests?\b/],
    excludes: [/\bselisih\b/, /\bdifference\b/, /\btransaksi\b/, /\btransactions?\b/, /\blaba\b/, /\bprofit\b/, /\bdiatribusikan\b/, /\battributable\b/],
  },
  {
    requirementId: "PRETAX_PROFIT_REPORTED",
    statement: "INCOME_STATEMENT",
    aliases: [/\blaba sebelum pajak penghasilan\b/, /\bincome before tax expense\b/, /\bprofit before (?:income )?tax\b/],
  },
  {
    requirementId: "TAX_EXPENSE_REPORTED",
    statement: "INCOME_STATEMENT",
    aliases: [/\bbeban pajak penghasilan\b/, /\bincome tax expense\b/],
  },
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[−–—]/g, "-").replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").replace(/\s+/g, " ").trim();
}

function isNumericPiece(text: string): boolean {
  return /^[\s\d.,()%+\-−–—]+$/.test(text) && /[\d()\-−–—]/.test(text);
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
    return [{ raw, decimal: parsed.decimal, center: (x1 + x2) / 2 }];
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

function scope(page: P0AIndexedPage, context: P0AIssuerContext): P0ANativeObservation["consolidationScope"] {
  if (/\b(?:consolidated|konsolidasian)\b/i.test(page.text)) return "CONSOLIDATED";
  return context.consolidated === false ? "STANDALONE" : "UNKNOWN";
}

function unitMetadata(requirementId: string, context: P0AIssuerContext) {
  const requirement = P0A_REQUIREMENT_BY_ID.get(requirementId);
  if (!requirement) throw new Error(`Unknown P0-A requirement ${requirementId}`);
  return {
    currency: requirement.unitType === "SHARES" ? "SHARES" : requirement.unitType === "PER_SHARE" ? `${context.currency}_PER_SHARE` : context.currency,
    unitType: requirement.unitType,
    scale: requirement.unitType === "DOCUMENT_CURRENCY" ? context.documentScale : "1",
  } as const;
}

function evidenceForRow(requirementId: string, page: P0ARoutedPage, row: LayoutRow, rawValue: string, columnLabel: string) {
  return {
    ...createEvidence({
      requirementId,
      page,
      statement: P0A_REQUIREMENT_BY_ID.get(requirementId)?.statementType ?? "OTHER",
      table: null,
      rowLabel: row.text,
      columnLabel,
      rawValue,
      snippet: page.text.slice(Math.max(0, page.text.indexOf(rawValue) - 180), Math.min(page.text.length, page.text.indexOf(rawValue) + rawValue.length + 220)),
    }),
    rowIndex: row.rowIndex,
  };
}

function exactObservation(rule: ExactRule, page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== rule.statement) return null;
  const requirement = P0A_REQUIREMENT_BY_ID.get(rule.requirementId);
  if (!requirement) return null;
  for (const row of logicalRows(page, context)) {
    if (!rule.aliases.some((alias) => alias.test(row.normalizedLabel))) continue;
    if (rule.excludes?.some((exclude) => exclude.test(row.normalizedLabel))) continue;
    const evidence = {
      ...createEvidence({
        requirementId: rule.requirementId,
        page,
        statement: rule.statement,
        table: null,
        rowLabel: row.label,
        columnLabel: row.columns.currentOnLeft ? "CURRENT_PERIOD_LEFT_COLUMN" : "CURRENT_PERIOD_RIGHT_COLUMN",
        rawValue: row.current.raw,
        snippet: page.text.slice(Math.max(0, page.text.indexOf(row.current.raw) - 180), Math.min(page.text.length, page.text.indexOf(row.current.raw) + row.current.raw.length + 220)),
      }),
      rowIndex: row.row.rowIndex,
      columnIndex: row.columns.currentOnLeft ? 0 : 1,
    };
    return {
      requirementId: rule.requirementId,
      origin: "REPORTED",
      state: row.current.decimal === "0" ? "ZERO" : "VALUE",
      decimalValue: row.current.decimal,
      rawValue: row.current.raw,
      ...unitMetadata(rule.requirementId, context),
      evidence: [evidence],
      rawLabel: row.label,
      statement: rule.statement,
      period: { start: context.periodStart, end: context.periodEnd, type: context.periodType, nature: requirement.periodNature },
      consolidationScope: scope(page, context),
      readConfidence: 1,
      mappingConfidence: 0.998,
      versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
    };
  }
  return null;
}

function treasuryShareCount(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "BALANCE_SHEET") return null;
  const match = /(?:Saham\s+treasuri|Treasury\s+shares?)[\s\S]{0,180}?(\d[\d.,]*)\s+(?:saham|shares)\s+(?:pada\s+tanggal|as\s+of)\b/i.exec(page.text);
  if (!match || match.index === undefined) return null;
  const parsed = parseFinancialDecimal(match[1]);
  if (!parsed || new Prisma.Decimal(parsed.decimal).abs().lessThan("1000000")) return null;
  const requirement = P0A_REQUIREMENT_BY_ID.get("TREASURY_SHARES_REPORTED");
  if (!requirement) return null;
  const evidence = createEvidence({
    requirementId: "TREASURY_SHARES_REPORTED",
    page,
    statement: "BALANCE_SHEET",
    table: null,
    rowLabel: "Treasury share count",
    columnLabel: context.periodEnd,
    rawValue: match[1],
    snippet: page.text.slice(Math.max(0, match.index - 100), Math.min(page.text.length, match.index + match[0].length + 120)),
  });
  return {
    requirementId: "TREASURY_SHARES_REPORTED",
    origin: "REPORTED",
    state: parsed.decimal === "0" ? "ZERO" : "VALUE",
    decimalValue: parsed.decimal,
    rawValue: match[1],
    currency: "SHARES",
    unitType: "SHARES",
    scale: "1",
    evidence: [evidence],
    rawLabel: "Treasury share count",
    statement: "BALANCE_SHEET",
    period: { start: context.periodStart, end: context.periodEnd, type: context.periodType, nature: requirement.periodNature },
    consolidationScope: scope(page, context),
    readConfidence: 1,
    mappingConfidence: 1,
    versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
  };
}

function precedingYear(rows: readonly LayoutRow[], rowIndex: number): string | null {
  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    const years = rows[index].text.match(/\b(?:19|20)\d{2}\b/g);
    if (years?.length) return years[0];
  }
  return null;
}

function weightedAverageSharesObservation(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "NOTE") return null;
  const requirement = P0A_REQUIREMENT_BY_ID.get("WEIGHTED_AVG_SHARES_REPORTED");
  if (!requirement) return null;
  const rows = layoutRows(page);
  const currentYear = context.periodEnd.slice(0, 4);
  for (const [index, row] of rows.entries()) {
    if (!/\b(?:laba per saham dasar|basic earnings per share)\b/.test(row.normalized)) continue;
    if (precedingYear(rows, index) !== currentYear) continue;
    const candidates = numericRuns(row).filter((run) => new Prisma.Decimal(run.decimal).abs().greaterThanOrEqualTo("1000000"));
    if (!candidates.length) continue;
    const selected = [...candidates].sort((left, right) => new Prisma.Decimal(right.decimal).abs().comparedTo(new Prisma.Decimal(left.decimal).abs()))[0];
    return {
      requirementId: "WEIGHTED_AVG_SHARES_REPORTED",
      origin: "REPORTED",
      state: selected.decimal === "0" ? "ZERO" : "VALUE",
      decimalValue: selected.decimal,
      rawValue: selected.raw,
      currency: "SHARES",
      unitType: "SHARES",
      scale: "1",
      evidence: [evidenceForRow("WEIGHTED_AVG_SHARES_REPORTED", page, row, selected.raw, context.periodEnd)],
      rawLabel: row.text,
      statement: "NOTE",
      period: { start: context.periodStart, end: context.periodEnd, type: context.periodType, nature: requirement.periodNature },
      consolidationScope: scope(page, context),
      readConfidence: 1,
      mappingConfidence: 0.999,
      versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
    };
  }
  return null;
}

function notDisclosedObservation(input: { requirementId: string; page: P0ARoutedPage; context: P0AIssuerContext; reason: string; snippet: string }): P0ANativeObservation {
  const requirement = P0A_REQUIREMENT_BY_ID.get(input.requirementId);
  if (!requirement) throw new Error(`Unknown P0-A requirement ${input.requirementId}`);
  const evidence = createEvidence({
    requirementId: input.requirementId,
    page: input.page,
    statement: requirement.statementType,
    table: null,
    rowLabel: input.reason,
    columnLabel: input.context.periodEnd,
    rawValue: "NOT_DISCLOSED",
    snippet: input.snippet,
  });
  return {
    requirementId: input.requirementId,
    origin: "REPORTED",
    state: "NOT_DISCLOSED",
    decimalValue: null,
    rawValue: "NOT_DISCLOSED",
    ...unitMetadata(input.requirementId, input.context),
    evidence: [evidence],
    rawLabel: input.reason,
    statement: requirement.statementType,
    period: { start: input.context.periodStart, end: input.context.periodEnd, type: input.context.periodType, nature: requirement.periodNature },
    consolidationScope: scope(input.page, input.context),
    readConfidence: 1,
    mappingConfidence: 1,
    versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
  };
}

function operatingProfitNotDisclosed(pages: readonly P0ARoutedPage[], context: P0AIssuerContext): P0ANativeObservation | null {
  const incomePages = pages.filter((page) => page.statementType === "INCOME_STATEMENT" && page.pageClass === "PRIMARY_INCOME_STATEMENT");
  if (!incomePages.length) return null;
  const combined = incomePages.map((page) => page.normalizedText).join(" ");
  const complete = /(?:jumlah pendapatan|total revenues?)/.test(combined)
    && /(?:laba sebelum pajak|income before tax|profit before tax)/.test(combined)
    && /(?:laba periode|profit for the period|profit for the year)/.test(combined);
  if (!complete) return null;
  if (/(?:operating profit|profit from operations|laba usaha|laba operasi|laba operasional)/.test(combined)) return null;
  const page = incomePages[0];
  return notDisclosedObservation({
    requirementId: "OPERATING_PROFIT_REPORTED",
    page,
    context,
    reason: "Complete primary income statement contains no issuer-defined operating-profit line.",
    snippet: incomePages.map((item) => item.text).join("\n").slice(0, 1400),
  });
}

function netChangeCashNotDisclosed(pages: readonly P0ARoutedPage[], context: P0AIssuerContext): P0ANativeObservation | null {
  const cashPages = pages.filter((page) => page.statementType === "CASH_FLOW" && page.pageClass === "PRIMARY_CASH_FLOW");
  if (!cashPages.length) return null;
  let scoped = 0;
  let unscoped = 0;
  for (const page of cashPages) {
    const text = page.normalizedText;
    const patterns = [/(?:net (?:increase|decrease|change) in cash(?: and cash equivalents)?)/g, /(?:(?:kenaikan|penurunan|perubahan) neto kas(?: dan setara kas)?)/g];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const start = match.index ?? 0;
        const segment = text.slice(Math.max(0, start - 180), start + 240);
        if (/(?:continuing operations|discontinued operations|operasi yang dilanjutkan|operasi yang dihentikan)/.test(segment)) scoped += 1;
        else unscoped += 1;
      }
    }
  }
  if (scoped === 0 || unscoped > 0) return null;
  const page = cashPages[cashPages.length - 1];
  return notDisclosedObservation({
    requirementId: "NET_CHANGE_CASH_REPORTED",
    page,
    context,
    reason: "Cash-flow statement reports scoped cash movements but no unscoped reported net-change scalar.",
    snippet: cashPages.map((item) => item.text).join("\n").slice(-1600),
  });
}

/** Final generic Phase 5 extractor layer used by the acceptance pipeline. */
export function createPhase5AcceptanceNativeExtractor(input: { routedPages: readonly P0ARoutedPage[]; context: P0AIssuerContext }) {
  const inner = createPhase5GenericNativeExtractor(input);
  const routedByNumber = new Map(input.routedPages.map((page) => [page.pageNumber, page]));
  return async (task: P0APlanTask, indexedPages: readonly P0AIndexedPage[]): Promise<P0ANativeObservation[]> => {
    const base = await inner(task, indexedPages);
    const selected = task.selectedPages.map((pageNumber) => routedByNumber.get(pageNumber)).filter((page): page is P0ARoutedPage => Boolean(page));
    const replacements: P0ANativeObservation[] = [];

    for (const rule of EXACT_RULES) {
      if (!task.requirementIds.includes(rule.requirementId)) continue;
      for (const page of selected) {
        const found = exactObservation(rule, page, input.context);
        if (found) { replacements.push(found); break; }
      }
    }

    if (task.requirementIds.includes("TREASURY_SHARES_REPORTED")) {
      for (const page of selected) {
        const found = treasuryShareCount(page, input.context);
        if (found) { replacements.push(found); break; }
      }
    }
    if (task.requirementIds.includes("WEIGHTED_AVG_SHARES_REPORTED")) {
      for (const page of selected) {
        const found = weightedAverageSharesObservation(page, input.context);
        if (found) { replacements.push(found); break; }
      }
    }

    if (task.requirementIds.includes("OPERATING_PROFIT_REPORTED")) {
      const absent = operatingProfitNotDisclosed(input.routedPages, input.context);
      if (absent) replacements.push(absent);
    }
    if (task.requirementIds.includes("NET_CHANGE_CASH_REPORTED")) {
      const absent = netChangeCashNotDisclosed(input.routedPages, input.context);
      if (absent) replacements.push(absent);
    }

    const preferred = new Map<string, P0ANativeObservation>();
    for (const item of replacements) if (!preferred.has(item.requirementId)) preferred.set(item.requirementId, item);
    return [...base.filter((item) => !preferred.has(item.requirementId)), ...preferred.values()];
  };
}
