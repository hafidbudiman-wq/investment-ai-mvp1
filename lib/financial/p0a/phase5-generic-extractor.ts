import { Prisma } from "@prisma/client";
import { createEvidence } from "@/lib/financial/p0a/evidence";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { createCrossIssuerNativeExtractor } from "@/lib/financial/p0a/cross-issuer-native-extractor";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type { P0AEvidence, P0AIndexedPage, P0AIssuerContext, P0ANativeObservation, P0APlanTask, P0ARoutedPage, P0AStatementType } from "@/lib/financial/p0a/types";
import { P0A_NATIVE_MAPPING_VERSION, P0A_PARSER_VERSION, P0A_ROUTER_VERSION, P0A_VALIDATION_VERSION } from "@/lib/financial/p0a/versions";

type NumericCandidate = { raw: string; decimal: string; offset: number; abs: Prisma.Decimal };
type TextRule = {
  requirementId: string;
  statement: P0AStatementType;
  anchors: readonly RegExp[];
  maxChars?: number;
  selector: "FIRST_LARGE" | "FIRST_CURRENCY" | "FIRST_PER_SHARE" | "LARGEST_LARGE" | "FIRST_SHARE_COUNT";
  rejectBeforeValue?: readonly RegExp[];
};

const LARGE = new Prisma.Decimal("1000");
const ONE = new Prisma.Decimal("1");

/*
 * Generic exact-row fallbacks for common PSAK/IFRS presentations.
 * No issuer/ticker/page/value predicate is permitted here.
 */
const TEXT_RULES: readonly TextRule[] = [
  {
    requirementId: "NET_PROFIT_REPORTED",
    statement: "INCOME_STATEMENT",
    anchors: [/\bLABA\s+PERIODE\/?TAHUN\s+BERJALAN\b/i, /\bPROFIT\s+FOR\s+THE\s+PERIOD\/?YEAR\b/i],
    selector: "FIRST_LARGE",
    rejectBeforeValue: [/\bDARI\s+OPERASI\b/i, /\bFROM\s+CONTINUING\s+OPERATIONS?\b/i, /\bFROM\s+DISCONTINUED\s+OPERATIONS?\b/i],
  },
  {
    requirementId: "NET_PROFIT_PARENT_REPORTED",
    statement: "INCOME_STATEMENT",
    anchors: [/\bLaba\s+periode\/?tahun\s+berjalan\s+yang\s+diatribusikan\s+kepada\s+pemilik\s+entitas\s+induk\b/i, /\bProfit\s+for\s+the\s+period\/?year\s+attributable\s+to\s+equity\s+holders?\s+of\s+the\s+parent/i],
    selector: "FIRST_LARGE",
    rejectBeforeValue: [/\bkomprehensif\b/i, /\bcomprehensive\b/i, /\bcontinuing\b/i, /\bdiscontinued\b/i],
  },
  {
    requirementId: "EPS_BASIC_REPORTED",
    statement: "INCOME_STATEMENT",
    anchors: [/\bLABA\s+PER\s+SAHAM\s+DASAR\s+YANG\s+DAPAT\s+DIATRIBUSIKAN\s+KEPADA\s+PEMILIK\s+ENTITAS\s+INDUK\b/i, /\bBASIC\s+EARNINGS\s+PER\s+SHARE\s+ATTRIBUTABLE\s+TO\s+EQUITY\s+HOLDERS?\s+OF\s+THE\s+PARENT/i],
    selector: "FIRST_PER_SHARE",
    rejectBeforeValue: [/\bDARI\s+OPERASI\b/i, /\bCONTINUING\s+OPERATIONS?\b/i],
  },
  {
    requirementId: "EQUITY_PARENT_REPORTED",
    statement: "BALANCE_SHEET",
    anchors: [/\bJumlah\s+ekuitas\s+yang\s+dapat\s+diatribusikan\s+kepada\s+pemilik\s+entitas\s+induk\b/i, /\bTotal\s+equity\s+attributable\s+to\s+(?:the\s+)?equity\s+holders?\s+of\s+the\s+parent/i],
    selector: "FIRST_LARGE",
  },
  {
    requirementId: "NCI_REPORTED",
    statement: "BALANCE_SHEET",
    anchors: [/(?:^|\n)\s*Kepentingan\s+nonpengendali\b/i, /(?:^|\n)\s*Non[- ]controlling\s+interests?\b/i],
    selector: "FIRST_LARGE",
    maxChars: 180,
  },
  {
    requirementId: "EQUITY_REPORTED",
    statement: "BALANCE_SHEET",
    anchors: [/(?:^|\n)\s*Jumlah\s+Ekuitas\b/i, /(?:^|\n)\s*Total\s+Equity\b/i],
    selector: "FIRST_LARGE",
    maxChars: 180,
    rejectBeforeValue: [/\battributable\b/i, /\bdiatribusikan\b/i],
  },
  {
    requirementId: "OCF_REPORTED",
    statement: "CASH_FLOW",
    anchors: [/\bKas\s+neto\s+diperoleh\s+dari\s+aktivitas\s+operasi\b/i, /\bNet\s+cash\s+(?:provided\s+by|from)\s+operating\s+activities\b/i],
    selector: "FIRST_LARGE",
  },
  {
    requirementId: "FX_EFFECT_CASH_REPORTED",
    statement: "CASH_FLOW",
    anchors: [/\bPERBEDAAN\s+NILAI\s+TUKAR\s+NETO\b/i, /\bNET\s+FOREIGN\s+EXCHANGE\s+DIFFERENCE\b/i],
    selector: "FIRST_CURRENCY",
  },
];

function snippet(page: P0AIndexedPage, start: number, end: number): string {
  return page.text.slice(Math.max(0, start - 160), Math.min(page.text.length, end + 220));
}

function numericCandidates(text: string): NumericCandidate[] {
  const regex = /\(?[-−–—]?\d[\d.,]*\)?/g;
  const candidates: NumericCandidate[] = [];
  for (const match of text.matchAll(regex)) {
    const raw = match[0];
    const parsed = parseFinancialDecimal(raw);
    if (!parsed || match.index === undefined) continue;
    const decimal = parsed.decimal;
    candidates.push({ raw, decimal, offset: match.index, abs: new Prisma.Decimal(decimal).abs() });
  }
  return candidates;
}

function chooseCandidate(rule: TextRule, afterAnchor: string): NumericCandidate | null {
  const candidates = numericCandidates(afterAnchor);
  if (rule.selector === "FIRST_PER_SHARE") {
    return candidates.find((candidate) => candidate.abs.lessThan(ONE) && candidate.raw.length >= 3) ?? null;
  }
  if (rule.selector === "LARGEST_LARGE") {
    return candidates.filter((candidate) => candidate.abs.greaterThanOrEqualTo(LARGE))
      .sort((a, b) => b.abs.comparedTo(a.abs))[0] ?? null;
  }
  if (rule.selector === "FIRST_SHARE_COUNT") {
    return candidates.find((candidate) => candidate.abs.greaterThanOrEqualTo("1000000")) ?? null;
  }
  if (rule.selector === "FIRST_LARGE") {
    return candidates.find((candidate) => candidate.abs.greaterThanOrEqualTo(LARGE)) ?? null;
  }
  return candidates.find((candidate) => candidate.abs.greaterThanOrEqualTo("1")) ?? null;
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

function observation(input: {
  requirementId: string;
  statement: P0AStatementType;
  page: P0ARoutedPage;
  context: P0AIssuerContext;
  anchorText: string;
  raw: string;
  decimal: string;
  start: number;
  end: number;
  state?: "VALUE" | "ZERO" | "NOT_APPLICABLE";
}): P0ANativeObservation {
  const requirement = P0A_REQUIREMENT_BY_ID.get(input.requirementId);
  if (!requirement) throw new Error(`Unknown P0-A requirement ${input.requirementId}`);
  const evidence: P0AEvidence = createEvidence({
    requirementId: input.requirementId,
    page: input.page,
    statement: input.statement,
    table: null,
    rowLabel: input.anchorText,
    columnLabel: input.context.periodEnd,
    rawValue: input.raw,
    snippet: snippet(input.page, input.start, input.end),
  });
  return {
    requirementId: input.requirementId,
    origin: "REPORTED",
    state: input.state ?? (input.decimal === "0" ? "ZERO" : "VALUE"),
    decimalValue: input.state === "NOT_APPLICABLE" ? null : input.decimal,
    rawValue: input.raw,
    ...unitMetadata(input.requirementId, input.context),
    evidence: [evidence],
    rawLabel: input.anchorText,
    statement: input.statement,
    period: { start: input.context.periodStart, end: input.context.periodEnd, type: input.context.periodType, nature: requirement.periodNature },
    consolidationScope: scope(input.page, input.context),
    readConfidence: 1,
    mappingConfidence: 0.995,
    versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
  };
}

function extractTextRule(rule: TextRule, page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== rule.statement) return null;
  for (const anchor of rule.anchors) {
    anchor.lastIndex = 0;
    const match = anchor.exec(page.text);
    if (!match || match.index === undefined) continue;
    const afterStart = match.index + match[0].length;
    const after = page.text.slice(afterStart, Math.min(page.text.length, afterStart + (rule.maxChars ?? 420)));
    const selected = chooseCandidate(rule, after);
    if (!selected) continue;
    const beforeValue = after.slice(0, selected.offset);
    if (rule.rejectBeforeValue?.some((pattern) => pattern.test(beforeValue))) continue;
    return observation({
      requirementId: rule.requirementId,
      statement: rule.statement,
      page,
      context,
      anchorText: match[0].trim(),
      raw: selected.raw,
      decimal: selected.decimal,
      start: match.index,
      end: afterStart + selected.offset + selected.raw.length,
    });
  }
  return null;
}

function extractTreasuryShareCount(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "BALANCE_SHEET") return null;
  const pattern = /(?:Saham\s+treasuri|Treasury\s+shares)[\s\S]{0,180}?(\d[\d.,]*)\s+saham\s+pada\s+tanggal/i;
  const match = pattern.exec(page.text);
  if (!match || match.index === undefined) return null;
  const parsed = parseFinancialDecimal(match[1]);
  if (!parsed || new Prisma.Decimal(parsed.decimal).abs().lessThan("1000000")) return null;
  return observation({
    requirementId: "TREASURY_SHARES_REPORTED", statement: "BALANCE_SHEET", page, context,
    anchorText: match[0].slice(0, match[0].indexOf(match[1])).trim(), raw: match[1], decimal: parsed.decimal,
    start: match.index, end: match.index + match[0].length,
  });
}

function extractEpsNote(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation[] {
  if (page.statementType !== "NOTE") return [];
  const currentYear = context.periodEnd.slice(0, 4);
  const yearAt = page.text.search(new RegExp(`\\b${currentYear}\\b`));
  if (yearAt < 0) return [];
  const basic = /\bLaba\s+per\s+saham\s+dasar\b/i.exec(page.text.slice(yearAt));
  if (!basic || basic.index === undefined) return [];
  const start = yearAt + basic.index;
  const segment = page.text.slice(start + basic[0].length, Math.min(page.text.length, start + basic[0].length + 520));
  const candidates = numericCandidates(segment);
  const large = candidates.filter((candidate) => candidate.abs.greaterThanOrEqualTo("1000000"));
  const perShare = candidates.find((candidate) => candidate.abs.lessThan(ONE) && candidate.raw.length >= 3) ?? null;
  const weighted = large.sort((a, b) => b.abs.comparedTo(a.abs))[0] ?? null;
  const output: P0ANativeObservation[] = [];
  if (weighted) output.push(observation({ requirementId: "WEIGHTED_AVG_SHARES_REPORTED", statement: "NOTE", page, context, anchorText: basic[0], raw: weighted.raw, decimal: weighted.decimal, start, end: start + basic[0].length + weighted.offset + weighted.raw.length }));
  if (perShare) output.push(observation({ requirementId: "EPS_BASIC_REPORTED", statement: "NOTE", page, context, anchorText: basic[0], raw: perShare.raw, decimal: perShare.decimal, start, end: start + basic[0].length + perShare.offset + perShare.raw.length }));
  return output;
}

function extractDilutedNotApplicable(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "NOTE") return null;
  const pattern = /(?:tidak\s+menghitung\s+laba\s+per\s+saham\s+dilusian[\s\S]{0,220}?tidak\s+terdapat\s+saham\s+biasa\s+yang\s+berpotensi\s+dilutif|did\s+not\s+calculate\s+diluted\s+earnings\s+per\s+share[\s\S]{0,220}?no\s+potentially\s+dilutive\s+ordinary\s+shares)/i;
  const match = pattern.exec(page.text);
  if (!match || match.index === undefined) return null;
  return observation({ requirementId: "EPS_DILUTED_REPORTED", statement: "NOTE", page, context, anchorText: "Diluted earnings per share applicability", raw: match[0], decimal: "0", start: match.index, end: match.index + match[0].length, state: "NOT_APPLICABLE" });
}

function isScopedUnsafe(observation: P0ANativeObservation, splitOperationsPresentation: boolean): boolean {
  const label = `${observation.rawLabel} ${observation.rawValue}`.toLowerCase();
  if (["NET_PROFIT_REPORTED", "NET_PROFIT_PARENT_REPORTED", "EPS_BASIC_REPORTED"].includes(observation.requirementId)) {
    if (/continuing|discontinued|operasi yang dilanjutkan|operasi yang dihentikan|tidak dilanjutkan/.test(label)) return true;
    if (splitOperationsPresentation && observation.state === "CONFLICT") return true;
  }
  if (["PRETAX_PROFIT_REPORTED", "TAX_EXPENSE_REPORTED"].includes(observation.requirementId)) {
    if (/continuing|discontinued|operasi yang dilanjutkan|operasi yang dihentikan/.test(label)) return true;
    if (splitOperationsPresentation && observation.state === "CONFLICT") return true;
  }
  if (observation.requirementId === "EQUITY_REPORTED" && /attribut|diatribusikan/.test(label)) return true;
  return false;
}

/**
 * Final Phase 5 generic native extractor layer. It resolves presentation/scope
 * ambiguity deterministically while preserving the frozen P0-A data contract.
 */
export function createPhase5GenericNativeExtractor(input: { routedPages: readonly P0ARoutedPage[]; context: P0AIssuerContext }) {
  const inner = createCrossIssuerNativeExtractor(input);
  const routedByNumber = new Map(input.routedPages.map((page) => [page.pageNumber, page]));
  return async (task: P0APlanTask, indexedPages: readonly P0AIndexedPage[]): Promise<P0ANativeObservation[]> => {
    const base = await inner(task, indexedPages);
    const selected = task.selectedPages.map((pageNumber) => routedByNumber.get(pageNumber)).filter((page): page is P0ARoutedPage => Boolean(page));
    const incomeText = selected.filter((page) => page.statementType === "INCOME_STATEMENT").map((page) => page.text).join("\n");
    const splitOperationsPresentation = /discontinued operations|operasi yang dihentikan/i.test(incomeText) && /continuing operations|operasi yang dilanjutkan/i.test(incomeText);

    const supplements: P0ANativeObservation[] = [];
    for (const rule of TEXT_RULES) {
      if (!task.requirementIds.includes(rule.requirementId)) continue;
      for (const page of selected) {
        const found = extractTextRule(rule, page, input.context);
        if (found) { supplements.push(found); break; }
      }
    }
    if (task.requirementIds.includes("TREASURY_SHARES_REPORTED")) {
      for (const page of selected) {
        const found = extractTreasuryShareCount(page, input.context);
        if (found) { supplements.push(found); break; }
      }
    }
    if (task.requirementIds.includes("WEIGHTED_AVG_SHARES_REPORTED") || task.requirementIds.includes("EPS_BASIC_REPORTED")) {
      for (const page of selected) supplements.push(...extractEpsNote(page, input.context).filter((item) => task.requirementIds.includes(item.requirementId)));
    }
    if (task.requirementIds.includes("EPS_DILUTED_REPORTED")) {
      for (const page of selected) {
        const found = extractDilutedNotApplicable(page, input.context);
        if (found) { supplements.push(found); break; }
      }
    }

    const preferred = new Map<string, P0ANativeObservation>();
    for (const item of supplements) if (!preferred.has(item.requirementId)) preferred.set(item.requirementId, item);
    const filtered = base.filter((item) => {
      if (isScopedUnsafe(item, splitOperationsPresentation)) return false;
      if (!preferred.has(item.requirementId)) return true;
      if (["EQUITY_REPORTED", "EQUITY_PARENT_REPORTED", "NCI_REPORTED", "NET_PROFIT_REPORTED", "NET_PROFIT_PARENT_REPORTED", "EPS_BASIC_REPORTED", "WEIGHTED_AVG_SHARES_REPORTED", "TREASURY_SHARES_REPORTED", "OCF_REPORTED", "FX_EFFECT_CASH_REPORTED", "EPS_DILUTED_REPORTED"].includes(item.requirementId)) return false;
      return true;
    });
    return [...filtered, ...preferred.values()];
  };
}
