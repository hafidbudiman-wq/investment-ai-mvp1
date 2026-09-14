import { Prisma } from "@prisma/client";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { createEvidence } from "@/lib/financial/p0a/evidence";
import { createPhase5AcceptanceNativeExtractor } from "@/lib/financial/p0a/phase5-acceptance-extractor";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type { P0AIndexedPage, P0AIssuerContext, P0ANativeObservation, P0APlanTask, P0ARoutedPage } from "@/lib/financial/p0a/types";
import { P0A_NATIVE_MAPPING_VERSION, P0A_PARSER_VERSION, P0A_ROUTER_VERSION, P0A_VALIDATION_VERSION } from "@/lib/financial/p0a/versions";

function isScopeCompatible(page: P0ARoutedPage, context: P0AIssuerContext): boolean {
  const explicitlyStandalone = /\b(?:separate statement|separate financial statements?|laporan[^\n]{0,80}tersendiri|informasi keuangan entitas induk|parent entity financial information)\b/i.test(page.text);
  const explicitlyConsolidated = /\b(?:consolidated|konsolidasian)\b/i.test(page.text);
  if (context.consolidated === true && explicitlyStandalone) return false;
  if (context.consolidated === false && explicitlyConsolidated && !explicitlyStandalone) return false;
  return true;
}

function statedScopePretax(page: P0ARoutedPage, context: P0AIssuerContext): P0ANativeObservation | null {
  if (!isScopeCompatible(page, context) || page.pageClass !== "PRIMARY_INCOME_STATEMENT" || page.statementType !== "INCOME_STATEMENT") return null;
  const requirement = P0A_REQUIREMENT_BY_ID.get("PRETAX_PROFIT_REPORTED");
  if (!requirement) return null;
  const anchors = [
    /laba\s+sebelum\s+pajak\s+penghasilan(?:\s+dari\s+operasi\s+yang\s+dilanjutkan)?/i,
    /(?:income|profit)\s+before\s+(?:income\s+)?tax(?:\s+expense)?(?:\s+from\s+continuing\s+operations?)?/i,
  ];
  for (const anchor of anchors) {
    const match = anchor.exec(page.text);
    if (!match || match.index === undefined) continue;
    const afterStart = match.index + match[0].length;
    const segment = page.text.slice(afterStart, Math.min(page.text.length, afterStart + 360));
    for (const numeric of segment.matchAll(/\(?[-−–—]?\d[\d.,]*\)?/g)) {
      if (numeric.index === undefined) continue;
      const parsed = parseFinancialDecimal(numeric[0]);
      if (!parsed || new Prisma.Decimal(parsed.decimal).abs().lessThan("1000")) continue;
      const rowEnd = afterStart + numeric.index + numeric[0].length;
      const rowLabel = page.text.slice(match.index, afterStart + numeric.index).replace(/\s+/g, " ").trim();
      const evidence = createEvidence({ requirementId: "PRETAX_PROFIT_REPORTED", page, statement: "INCOME_STATEMENT", table: null, rowLabel, columnLabel: context.periodEnd, rawValue: numeric[0], snippet: page.text.slice(Math.max(0, match.index - 120), Math.min(page.text.length, rowEnd + 180)) });
      return {
        requirementId: "PRETAX_PROFIT_REPORTED", origin: "REPORTED", state: parsed.decimal === "0" ? "ZERO" : "VALUE", decimalValue: parsed.decimal, rawValue: numeric[0], currency: context.currency,
        unitType: requirement.unitType, scale: context.documentScale, evidence: [evidence], rawLabel: rowLabel, statement: "INCOME_STATEMENT",
        period: { start: context.periodStart, end: context.periodEnd, type: context.periodType, nature: requirement.periodNature },
        consolidationScope: /\b(?:consolidated|konsolidasian)\b/i.test(page.text) ? "CONSOLIDATED" : context.consolidated === false ? "STANDALONE" : "UNKNOWN",
        readConfidence: 1, mappingConfidence: 0.999,
        versions: { parser: P0A_PARSER_VERSION, router: P0A_ROUTER_VERSION, mapping: P0A_NATIVE_MAPPING_VERSION, validation: P0A_VALIDATION_VERSION },
      };
    }
  }
  return null;
}

/**
 * Final deterministic resolution layer. Explicit standalone supplementary
 * statements are excluded from a consolidated extraction context before the
 * existing generic mapper runs. No issuer/page/value checks.
 */
export function createPhase5FinalNativeExtractor(input: { routedPages: readonly P0ARoutedPage[]; context: P0AIssuerContext }) {
  const scopeCompatiblePages = input.routedPages.filter((page) => isScopeCompatible(page, input.context));
  const inner = createPhase5AcceptanceNativeExtractor({ ...input, routedPages: scopeCompatiblePages });
  const routedByNumber = new Map(scopeCompatiblePages.map((page) => [page.pageNumber, page]));
  return async (task: P0APlanTask, indexedPages: readonly P0AIndexedPage[]): Promise<P0ANativeObservation[]> => {
    const base = await inner(task, indexedPages);
    if (!task.requirementIds.includes("PRETAX_PROFIT_REPORTED")) return base;
    for (const pageNumber of task.selectedPages) {
      const page = routedByNumber.get(pageNumber);
      if (!page) continue;
      const found = statedScopePretax(page, input.context);
      if (found) return [...base.filter((item) => item.requirementId !== "PRETAX_PROFIT_REPORTED"), found];
    }
    return base;
  };
}
