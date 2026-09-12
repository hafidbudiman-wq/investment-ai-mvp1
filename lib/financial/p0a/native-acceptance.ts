import { ICBP_GOLD_CALCULATED_ALTERNATIVES, ICBP_GOLD_DIRECT_FACTS } from "@/lib/financial/p0a/mock-extractor";
import type { P0ANativeObservation, P0ARequirementOutcome, P0ARoutedPage } from "@/lib/financial/p0a/types";

export function evaluateIcbpNativeAcceptance(input: {
  observations: readonly P0ANativeObservation[];
  outcomes: readonly P0ARequirementOutcome[];
  routedPages: readonly P0ARoutedPage[];
  selectedPages: readonly number[];
  latencyMs: number;
}) {
  const reported = new Map(input.observations.filter((item) => item.origin === "REPORTED").map((item) => [item.requirementId, item]));
  const calculated = new Map(input.observations.filter((item) => item.origin === "STANDARDIZED_AGGREGATE").map((item) => [item.requirementId, item]));
  const valueGold = ICBP_GOLD_DIRECT_FACTS.filter((item) => item.state !== "NOT_APPLICABLE");
  const comparisons = valueGold.map((gold) => {
    const id = `${gold.code}_REPORTED`;
    const actual = reported.get(id);
    const expectedUnit = gold.unit ?? "DOCUMENT_CURRENCY";
    const expectedScale = gold.scale ?? "1000000";
    return {
      requirementId: id,
      exactValue: actual?.decimalValue === gold.value,
      exactUnit: actual?.unitType === expectedUnit && actual?.scale === expectedScale,
      exactPeriod: actual?.period.end === "2025-06-30" && actual?.period.type === "H1",
      exactScope: actual?.consolidationScope === "CONSOLIDATED",
      evidenceComplete: Boolean(actual?.evidence.length) && actual!.evidence.every((evidence) => Boolean(evidence.pageNumber && evidence.rowLabel && evidence.columnLabel && evidence.rawValue && evidence.snippetHash && evidence.locatorHash && evidence.evidenceHash)),
    };
  });
  const notApplicableGold = ICBP_GOLD_DIRECT_FACTS.filter((item) => item.state === "NOT_APPLICABLE");
  const notApplicableCorrect = notApplicableGold.filter((gold) => reported.get(`${gold.code}_REPORTED`)?.state === "NOT_APPLICABLE").length;
  const aggregateComparisons = ICBP_GOLD_CALCULATED_ALTERNATIVES.map((gold) => ({
    requirementId: `${gold.code}_REPORTED`,
    exactValue: calculated.get(`${gold.code}_REPORTED`)?.decimalValue === gold.value,
    remainedCalculated: calculated.get(`${gold.code}_REPORTED`)?.origin === "STANDARDIZED_AGGREGATE" && !reported.has(`${gold.code}_REPORTED`),
  }));
  const incorrectFacts = comparisons.filter((item) => !item.exactValue || !item.exactUnit || !item.exactPeriod || !item.exactScope).map((item) => item.requirementId);
  const byState = (state: string) => input.outcomes.filter((outcome) => outcome.state === state).length;
  const safelyClassified = input.outcomes.filter((outcome) => !["MISSING", "AMBIGUOUS", "CONFLICT"].includes(outcome.state)).length;
  const goldCorrect = comparisons.filter((item) => item.exactValue && item.exactUnit && item.exactPeriod && item.exactScope).length + notApplicableCorrect;
  const routedSelectedCharacters = input.routedPages.filter((page) => input.selectedPages.includes(page.pageNumber)).reduce((sum, page) => sum + page.text.length, 0);
  return {
    factsResolvedNatively: byState("VALUE") + byState("ZERO"),
    factsAmbiguous: byState("AMBIGUOUS"),
    factsMissing: byState("MISSING"),
    factsNotDisclosed: byState("NOT_DISCLOSED"),
    factsNotApplicable: byState("NOT_APPLICABLE"),
    conflicts: byState("CONFLICT"),
    incorrectFacts,
    reportedGoldCoveragePct: Number(((goldCorrect / ICBP_GOLD_DIRECT_FACTS.length) * 100).toFixed(2)),
    safelyClassifiedRequirementCoveragePct: Number(((safelyClassified / input.outcomes.length) * 100).toFixed(2)),
    digitAndSignAccuracyPct: Number(((comparisons.filter((item) => item.exactValue).length / comparisons.length) * 100).toFixed(2)),
    unitAndScaleAccuracyPct: Number(((comparisons.filter((item) => item.exactUnit).length / comparisons.length) * 100).toFixed(2)),
    periodAccuracyPct: Number(((comparisons.filter((item) => item.exactPeriod).length / comparisons.length) * 100).toFixed(2)),
    consolidationScopeAccuracyPct: Number(((comparisons.filter((item) => item.exactScope).length / comparisons.length) * 100).toFixed(2)),
    evidenceCompletenessPct: Number(((comparisons.filter((item) => item.evidenceComplete).length / comparisons.length) * 100).toFixed(2)),
    calculatedAlternativeAccuracyPct: Number(((aggregateComparisons.filter((item) => item.exactValue && item.remainedCalculated).length / aggregateComparisons.length) * 100).toFixed(2)),
    nativeProcessingLatencyMs: input.latencyMs,
    totalPdfPages: input.routedPages.length,
    nativeIndexedPages: input.routedPages.length,
    routerSelectedPages: [...input.selectedPages],
    routerSelectedCharacterCount: routedSelectedCharacters,
    unresolvedForAi: input.outcomes.filter((outcome) => ["MISSING", "AMBIGUOUS", "CONFLICT"].includes(outcome.state)).map((outcome) => outcome.requirementId),
    providerCalls: 0,
    fullDocumentFallbacks: 0,
    productionCanonicalWrites: 0,
    details: { comparisons, aggregateComparisons },
  };
}
