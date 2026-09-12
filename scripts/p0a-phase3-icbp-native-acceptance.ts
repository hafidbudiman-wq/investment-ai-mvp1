import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { evaluateIcbpNativeAcceptance } from "../lib/financial/p0a/native-acceptance";
import { runP0ANativePipeline } from "../lib/financial/p0a/pipeline";
import type { P0ANativeObservation } from "../lib/financial/p0a/types";

const EXPECTED_SHA = "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089";
const pdfPath = process.env.P0A_ICBP_PDF_PATH;
if (!pdfPath) throw new Error("P0A_ICBP_PDF_PATH is required.");

const context = {
  ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL",
  consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30",
  periodType: "H1", currency: "IDR", documentScale: "1000000",
} as const;

async function main() {
  const bytes = await readFile(pdfPath!);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== EXPECTED_SHA) throw new Error(`Unexpected ICBP PDF SHA-256: ${sha}`);
  const result = await runP0ANativePipeline({ bytes, context });
  const metrics = evaluateIcbpNativeAcceptance({
    observations: result.observations as P0ANativeObservation[], outcomes: result.outcomes,
    routedPages: result.routedPages, selectedPages: result.selectedPages,
    latencyMs: result.usage.processingLatencyMs,
  });
  const acceptance = {
    source: "ICBP H1 2025", sha256: sha, expectedDocumentPages: 109,
    extractionMode: "GENERIC_NATIVE_FINANCIAL_EXTRACTOR",
    validations: result.validations,
    metrics,
    gates: {
      routing: JSON.stringify(result.selectedPages) === JSON.stringify([4, 5, 6, 7, 8, 9, 10, 86, 88]),
      criticalAccuracy: metrics.incorrectFacts.length === 0 && metrics.digitAndSignAccuracyPct === 100 && metrics.unitAndScaleAccuracyPct === 100 && metrics.periodAccuracyPct === 100 && metrics.consolidationScopeAccuracyPct === 100,
      applicableDisclosedCoverage: metrics.reportedGoldCoveragePct >= 95,
      evidenceTraceability: metrics.evidenceCompletenessPct === 100,
      validationControls: result.validations.every((check) => check.passed),
      fullDocumentFallbackZero: metrics.fullDocumentFallbacks === 0,
      providerCallsZeroBeforeApproval: metrics.providerCalls === 0,
      canonicalWritesZero: metrics.productionCanonicalWrites === 0,
    },
  };
  if (!Object.values(acceptance.gates).every(Boolean)) throw new Error(`Phase 3A acceptance failed: ${JSON.stringify(acceptance)}`);
  console.log(JSON.stringify(acceptance, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
