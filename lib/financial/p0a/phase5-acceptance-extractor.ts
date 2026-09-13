import { createEvidence } from "@/lib/financial/p0a/evidence";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { createPhase5GenericNativeExtractor } from "@/lib/financial/p0a/phase5-generic-extractor";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type { P0AIndexedPage, P0AIssuerContext, P0ANativeObservation, P0APlanTask, P0ARoutedPage } from "@/lib/financial/p0a/types";
import { P0A_NATIVE_MAPPING_VERSION, P0A_PARSER_VERSION, P0A_ROUTER_VERSION, P0A_VALIDATION_VERSION } from "@/lib/financial/p0a/versions";

function totalEquityObservation(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (page.statementType !== "BALANCE_SHEET") return null;
  const match = /(?:^|\n)\s*(Jumlah\s+Ekuitas(?!\s+yang\b)|Total\s+Equity(?!\s+attributable\b))[\s\S]{0,120}?(\(?[-−–—]?\d[\d.,]*\)?)/im.exec(page.text);
  if (!match || match.index === undefined) return null;
  const parsed = parseFinancialDecimal(match[2]);
  if (!parsed) return null;
  const requirement = P0A_REQUIREMENT_BY_ID.get("EQUITY_REPORTED");
  if (!requirement) return null;
  const start = match.index;
  const evidence = createEvidence({
    requirementId: "EQUITY_REPORTED",
    page,
    statement: "BALANCE_SHEET",
    table: null,
    rowLabel: match[1],
    columnLabel: context.periodEnd,
    rawValue: match[2],
    snippet: page.text.slice(Math.max(0, start - 140), Math.min(page.text.length, start + match[0].length + 180)),
  });
  return {
    requirementId: "EQUITY_REPORTED",
    origin: "REPORTED",
    state: parsed.decimal === "0" ? "ZERO" : "VALUE",
    decimalValue: parsed.decimal,
    rawValue: match[2],
    currency: context.currency,
    unitType: requirement.unitType,
    scale: context.documentScale,
    evidence: [evidence],
    rawLabel: match[1],
    statement: "BALANCE_SHEET",
    period: { start: context.periodStart, end: context.periodEnd, type: context.periodType, nature: requirement.periodNature },
    consolidationScope: /\b(?:consolidated|konsolidasian)\b/i.test(page.text) ? "CONSOLIDATED" : context.consolidated === false ? "STANDALONE" : "UNKNOWN",
    readConfidence: 1,
    mappingConfidence: 0.995,
    versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
  };
}

/** Final generic Phase 5 extractor layer used by the acceptance pipeline. */
export function createPhase5AcceptanceNativeExtractor(input: { routedPages: readonly P0ARoutedPage[]; context: P0AIssuerContext }) {
  const inner = createPhase5GenericNativeExtractor(input);
  const routedByNumber = new Map(input.routedPages.map((page) => [page.pageNumber, page]));
  return async (task: P0APlanTask, indexedPages: readonly P0AIndexedPage[]): Promise<P0ANativeObservation[]> => {
    const base = await inner(task, indexedPages);
    if (!task.requirementIds.includes("EQUITY_REPORTED")) return base;
    for (const pageNumber of task.selectedPages) {
      const page = routedByNumber.get(pageNumber);
      if (!page) continue;
      const exact = totalEquityObservation(page, input.context);
      if (exact) return [...base.filter((item) => item.requirementId !== "EQUITY_REPORTED"), exact];
    }
    return base;
  };
}
