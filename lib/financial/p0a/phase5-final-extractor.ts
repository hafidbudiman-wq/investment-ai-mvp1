import { Prisma } from "@prisma/client";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { createEvidence } from "@/lib/financial/p0a/evidence";
import { createPhase5AcceptanceNativeExtractor } from "@/lib/financial/p0a/phase5-acceptance-extractor";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type { P0AIndexedPage, P0AIssuerContext, P0ANativeObservation, P0APlanTask, P0ARoutedPage, P0AStatementType } from "@/lib/financial/p0a/types";
import { P0A_NATIVE_MAPPING_VERSION, P0A_PARSER_VERSION, P0A_ROUTER_VERSION, P0A_VALIDATION_VERSION } from "@/lib/financial/p0a/versions";

function isScopeCompatible(page: P0ARoutedPage, context: P0AIssuerContext): boolean {
  const explicitlyStandalone = /\b(?:separate statement|separate financial statements?|laporan[^\n]{0,80}tersendiri|informasi keuangan entitas induk|parent entity financial information)\b/i.test(page.text);
  const explicitlyConsolidated = /\b(?:consolidated|konsolidasian)\b/i.test(page.text);
  if (context.consolidated === true && explicitlyStandalone) return false;
  if (context.consolidated === false && explicitlyConsolidated && !explicitlyStandalone) return false;
  return true;
}

function observation(input: {
  requirementId: string;
  page: P0ARoutedPage;
  context: P0AIssuerContext;
  statement: P0AStatementType;
  rowLabel: string;
  rawValue: string;
  decimalValue: string;
  start: number;
  end: number;
  mappingConfidence?: number;
}): P0ANativeObservation | null {
  const requirement = P0A_REQUIREMENT_BY_ID.get(input.requirementId);
  if (!requirement) return null;
  const currency = requirement.unitType === "SHARES" ? "SHARES" : requirement.unitType === "PER_SHARE" ? `${input.context.currency}_PER_SHARE` : input.context.currency;
  const scale = requirement.unitType === "DOCUMENT_CURRENCY" ? input.context.documentScale : "1";
  return {
    requirementId: input.requirementId,
    origin: "REPORTED",
    state: input.decimalValue === "0" ? "ZERO" : "VALUE",
    decimalValue: input.decimalValue,
    rawValue: input.rawValue,
    currency,
    unitType: requirement.unitType,
    scale,
    evidence: [createEvidence({
      requirementId: input.requirementId,
      page: input.page,
      statement: input.statement,
      table: null,
      rowLabel: input.rowLabel,
      columnLabel: input.context.periodEnd,
      rawValue: input.rawValue,
      snippet: input.page.text.slice(Math.max(0, input.start - 160), Math.min(input.page.text.length, input.end + 220)),
    })],
    rawLabel: input.rowLabel,
    statement: input.statement,
    period: { start: input.context.periodStart, end: input.context.periodEnd, type: input.context.periodType, nature: requirement.periodNature },
    consolidationScope: /\b(?:consolidated|konsolidasian)\b/i.test(input.page.text) ? "CONSOLIDATED" : input.context.consolidated === false ? "STANDALONE" : "UNKNOWN",
    readConfidence: 1,
    mappingConfidence: input.mappingConfidence ?? 0.999,
    versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
  };
}

// A financial token must stop before the next whitespace-delimited column.
// OCR table rows often place the comparative-period value immediately after
// the current-period value; allowing arbitrary spaced 3-digit groups would
// merge two columns into one synthetic number.
const FINANCIAL_NUMBER = /\(\s*\d[\d.,]*\s*\)|[-−–—]\s*\d[\d.,]*|\d[\d.,]*/g;

function firstNumberAfter(input: {
  requirementId: string;
  page: P0ARoutedPage;
  context: P0AIssuerContext;
  statement: P0AStatementType;
  anchors: readonly RegExp[];
  maxChars?: number;
  minAbs?: string;
}): P0ANativeObservation | null {
  for (const anchor of input.anchors) {
    anchor.lastIndex = 0;
    const match = anchor.exec(input.page.text);
    if (!match || match.index === undefined) continue;
    const afterStart = match.index + match[0].length;
    const segment = input.page.text.slice(afterStart, Math.min(input.page.text.length, afterStart + (input.maxChars ?? 260)));
    FINANCIAL_NUMBER.lastIndex = 0;
    for (const numeric of segment.matchAll(FINANCIAL_NUMBER)) {
      if (numeric.index === undefined) continue;
      const parsed = parseFinancialDecimal(numeric[0]);
      if (!parsed) continue;
      if (input.minAbs && new Prisma.Decimal(parsed.decimal).abs().lessThan(input.minAbs)) continue;
      return observation({ requirementId: input.requirementId, page: input.page, context: input.context, statement: input.statement, rowLabel: match[0].replace(/\s+/g, " ").trim(), rawValue: numeric[0], decimalValue: parsed.decimal, start: match.index, end: afterStart + numeric.index + numeric[0].length });
    }
  }
  return null;
}

function issuedShares(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "BALANCE_SHEET") return null;
  const match = /(?:modal\s+ditempatkan\s+dan\s+disetor|issued\s+and\s+fully\s+paid)[\s\S]{0,180}?(\d[\d.,]*)\s+(?:saham|shares)\b/i.exec(page.text);
  if (!match || match.index === undefined) return null;
  const parsed = parseFinancialDecimal(match[1]);
  if (!parsed || new Prisma.Decimal(parsed.decimal).abs().lessThan("1000000")) return null;
  return observation({ requirementId: "SHARES_ISSUED_REPORTED", page, context, statement: "BALANCE_SHEET", rowLabel: match[0].slice(0, match[0].indexOf(match[1])).replace(/\s+/g, " ").trim(), rawValue: match[1], decimalValue: parsed.decimal, start: match.index, end: match.index + match[0].length });
}

function combinedEps(page: P0ARoutedPage, context: P0AIssuerContext, requirementId: "EPS_BASIC_REPORTED" | "EPS_DILUTED_REPORTED"): P0ANativeObservation | null {
  if (page.statementType !== "INCOME_STATEMENT" && page.statementType !== "NOTE") return null;
  const aliases = [
    /TOTAL\s+LABA\s+BERSIH\s+PER\s+SAHAM/i,
    /TOTAL\s+EARNINGS\s+PER\s+SHARE/i,
    /Laba\s+per\s+saham\s+dasar\s*\/\s*dilusian/i,
    /Basic\s*\/\s*diluted\s+earnings\s+per\s+share/i,
  ];
  for (const alias of aliases) {
    const match = alias.exec(page.text);
    if (!match || match.index === undefined) continue;
    const lineEnd = page.text.indexOf("\n", match.index);
    const segmentEnd = lineEnd >= 0 ? lineEnd : Math.min(page.text.length, match.index + 260);
    const segment = page.text.slice(match.index + match[0].length, segmentEnd);
    const numbers = [...segment.matchAll(/\d+(?:[.,]\d+)*/g)].flatMap((item) => {
      const parsed = parseFinancialDecimal(item[0]);
      return parsed && item.index !== undefined ? [{ raw: item[0], decimal: parsed.decimal, index: item.index }] : [];
    });
    if (!numbers.length) continue;
    const selected = numbers.length >= 3 && new Prisma.Decimal(numbers[0].decimal).abs().lessThan("1000") ? numbers[1] : numbers[0];
    return observation({ requirementId, page, context, statement: page.statementType, rowLabel: match[0], rawValue: selected.raw, decimalValue: selected.decimal, start: match.index, end: match.index + match[0].length + selected.index + selected.raw.length });
  }
  return null;
}

function weightedAverageShares(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "NOTE" && page.statementType !== "INCOME_STATEMENT") return null;
  return firstNumberAfter({
    requirementId: "WEIGHTED_AVG_SHARES_REPORTED", page, context, statement: page.statementType, minAbs: "1000000", maxChars: 220,
    anchors: [
      /rata[- ]rata\s+tertimbang\s+(?:jumlah\s+)?saham\s+biasa\s+yang\s+beredar/i,
      /weighted\s+average\s+number\s+of\s+(?:ordinary\s+)?shares?\s+(?:outstanding)?/i,
    ],
  });
}

function reportedFallbacks(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation[] {
  if (!isScopeCompatible(page, context)) return [];
  const output: Array<P0ANativeObservation | null> = [];
  if (page.statementType === "INCOME_STATEMENT") {
    output.push(firstNumberAfter({ requirementId: "TAX_EXPENSE_REPORTED", page, context, statement: "INCOME_STATEMENT", minAbs: "1000", anchors: [/beban\s+pajak\s+penghasilan\s*-?\s*neto/i, /income\s+tax\s+expense\s*-?\s*net/i] }));
    output.push(firstNumberAfter({ requirementId: "NET_PROFIT_REPORTED", page, context, statement: "INCOME_STATEMENT", minAbs: "1000", anchors: [/laba\s+neto\s+untuk\s+tahun\s+berjalan/i, /net\s+profit\s+for\s+the\s+year/i, /profit\s+for\s+the\s+year/i] }));
    output.push(combinedEps(page, context, "EPS_BASIC_REPORTED"), combinedEps(page, context, "EPS_DILUTED_REPORTED"));
  }
  if (page.statementType === "BALANCE_SHEET") {
    output.push(firstNumberAfter({ requirementId: "EQUITY_PARENT_REPORTED", page, context, statement: "BALANCE_SHEET", minAbs: "1000", maxChars: 260, anchors: [/total\s+ekuitas\s+yang\s+(?:dapat\s+)?diatribusikan\s+kepada\s+pemilik\s+entitas\s+induk/i, /total\s+equity\s+attributable\s+to\s+(?:the\s+)?owners?\s+of\s+the\s+parent(?:\s+company)?/i] }));
    output.push(issuedShares(page, context));
  }
  if (page.statementType === "CASH_FLOW") {
    output.push(firstNumberAfter({ requirementId: "ICF_REPORTED", page, context, statement: "CASH_FLOW", minAbs: "1000", anchors: [/kas\s+neto\s+digunakan\s+untuk\s+aktivitas\s+investasi/i, /net\s+cash\s+used\s+in\s+investing\s+activities/i] }));
    output.push(firstNumberAfter({ requirementId: "CFF_REPORTED", page, context, statement: "CASH_FLOW", minAbs: "1000", anchors: [/kas\s+neto\s+digunakan\s+untuk\s+aktivitas\s+pendanaan/i, /net\s+cash\s+used\s+in\s+financing\s+activities/i] }));
    output.push(firstNumberAfter({ requirementId: "NET_CHANGE_CASH_REPORTED", page, context, statement: "CASH_FLOW", minAbs: "1000", anchors: [/kenaikan\s+neto\s+kas\s+dan\s+setara\s+kas/i, /penurunan\s+neto\s+kas\s+dan\s+setara\s+kas/i, /net\s+(?:increase|decrease)\s+in\s+cash\s+and\s+cash\s+equivalents/i] }));
    output.push(firstNumberAfter({ requirementId: "FX_EFFECT_CASH_REPORTED", page, context, statement: "CASH_FLOW", minAbs: "1", anchors: [/dampak\s+perubahan\s+selisih\s+kurs\s+terhadap\s+kas\s+dan\s+setara\s+kas/i, /effect\s+of\s+exchange\s+rate\s+difference\s+on\s+cash\s+and\s+cash\s+equivalents/i] }));
  }
  if (page.statementType === "NOTE") output.push(weightedAverageShares(page, context), combinedEps(page, context, "EPS_BASIC_REPORTED"), combinedEps(page, context, "EPS_DILUTED_REPORTED"));
  return output.filter((item): item is P0ANativeObservation => item !== null);
}

function statedScopePretax(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (!isScopeCompatible(page, context) || page.pageClass !== "PRIMARY_INCOME_STATEMENT" || page.statementType !== "INCOME_STATEMENT") return null;
  return firstNumberAfter({ requirementId: "PRETAX_PROFIT_REPORTED", page, context, statement: "INCOME_STATEMENT", minAbs: "1000", anchors: [/laba\s+sebelum\s+pajak\s+penghasilan(?:\s+dari\s+operasi\s+yang\s+dilanjutkan)?/i, /(?:income|profit)\s+before\s+(?:income\s+)?tax(?:\s+expense)?(?:\s+from\s+continuing\s+operations?)?/i] });
}

/** Final deterministic layer; no issuer/page/value predicate is permitted. */
export function createPhase5FinalNativeExtractor(input: { routedPages: readonly P0ARoutedPage[]; context: P0AIssuerContext }) {
  const scopeCompatiblePages = input.routedPages.filter((page) => isScopeCompatible(page, input.context));
  const inner = createPhase5AcceptanceNativeExtractor({ ...input, routedPages: scopeCompatiblePages });
  const routedByNumber = new Map(scopeCompatiblePages.map((page) => [page.pageNumber, page]));
  return async (task: P0APlanTask, indexedPages: readonly P0AIndexedPage[]): Promise<P0ANativeObservation[]> => {
    const base = await inner(task, indexedPages);
    const output = [...base];
    const upsert = (item: P0ANativeObservation, force = false) => {
      if (!task.requirementIds.includes(item.requirementId)) return;
      const existing = output.findIndex((candidate) => candidate.requirementId === item.requirementId);
      if (existing < 0) output.push(item);
      else if (force) output.splice(existing, 1, item);
    };
    for (const pageNumber of task.selectedPages) {
      const page = routedByNumber.get(pageNumber);
      if (!page) continue;
      const pretax = statedScopePretax(page, input.context);
      if (pretax) upsert(pretax, true);
      for (const fallback of reportedFallbacks(page, input.context)) {
        const force = fallback.requirementId === "TAX_EXPENSE_REPORTED";
        upsert(fallback, force);
      }
    }
    return output;
  };
}
