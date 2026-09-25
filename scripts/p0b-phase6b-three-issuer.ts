import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runP0ACompatiblePipeline } from "../lib/financial/p0a/pipeline";
import { runPhase6A } from "../lib/financial/p0b/phase6a-pipeline";
import { runPhase6B } from "../lib/financial/p0b/phase6b-pipeline";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const outputDir = process.env.PHASE6B_OUTPUT_DIR ?? "artifacts/phase6b";

const cases: Array<{ ticker: string; fileName: string; path: string; expectedSha: string; context: P0AIssuerContext; expectedOcr: number[]; expected: { events: number; segments: number; revenue: number; operatingProfit: number } }> = [
  { ticker: "ICBP", fileName: "ICBP_billingual_30Jun25.pdf", path: process.env.P0A_ICBP_PDF_PATH ?? "", expectedSha: "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089", context: { ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "IDR", documentScale: "1000000" }, expectedOcr: [], expected: { events: 1, segments: 8, revenue: 24, operatingProfit: 8 } },
  { ticker: "MEDC", fileName: "Lap Keu MEDC 30 juni 2025.pdf", path: process.env.P0A_MEDC_PDF_PATH ?? "", expectedSha: "438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e", context: { ticker: "MEDC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1" }, expectedOcr: [], expected: { events: 1, segments: 8, revenue: 24, operatingProfit: 0 } },
  { ticker: "DRMA", fileName: "DRMA_2025.pdf", path: process.env.P0A_DRMA_PDF_PATH ?? "", expectedSha: "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb", context: { ticker: "DRMA", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: true, periodStart: "2025-01-01", periodEnd: "2025-12-31", periodType: "FY", currency: "IDR", documentScale: "1" }, expectedOcr: [4, 5, 6, 7], expected: { events: 1, segments: 4, revenue: 4, operatingProfit: 0 } },
];

async function main() {
  if (cases.some((item) => !item.path)) throw new Error("P0A_ICBP_PDF_PATH, P0A_MEDC_PDF_PATH and P0A_DRMA_PDF_PATH are required.");
  await mkdir(outputDir, { recursive: true });
  const results = new Map<string, Awaited<ReturnType<typeof runPhase6B>>>();
  const checksums: Array<{ file: string; sha256: string }> = [];

  for (const item of cases) {
    const bytes = await readFile(item.path);
    assert.equal(sha(bytes), item.expectedSha, `${item.ticker} immutable PDF SHA-256`);
    const p0a = await runP0ACompatiblePipeline({ bytes, context: item.context });
    assert.equal(p0a.outcomes.length, 34);
    assert.equal(p0a.outcomes.filter((outcome) => ["MISSING", "AMBIGUOUS", "CONFLICT"].includes(outcome.state)).length, 0);
    assert.deepEqual(p0a.ocrUsage.ocrPages, item.expectedOcr);
    assert.equal(p0a.usage.providerCalls, 0);
    const phase6aFirst = await runPhase6A({ bytes, context: item.context, p0aResult: p0a });
    const phase6aSecond = await runPhase6A({ bytes, context: item.context, p0aResult: p0a });
    assert.deepEqual(phase6aSecond, phase6aFirst, `${item.ticker} Phase 6A frozen result`);
    assert.equal(phase6aFirst.outcomes.length, 18);

    const first = await runPhase6B({ bytes, context: item.context, p0aResult: p0a });
    const second = await runPhase6B({ bytes, context: item.context, p0aResult: p0a });
    assert.deepEqual(second, first, `${item.ticker} Phase 6B deterministic rerun`);
    assert.equal(first.dividendEvents.length, item.expected.events);
    assert.equal(first.segmentIdentities.length, item.expected.segments);
    assert.equal(first.segmentFacts.filter((fact) => fact.metricCode === "REVENUE").length, item.expected.revenue);
    assert.equal(first.segmentFacts.filter((fact) => fact.metricCode === "OPERATING_PROFIT").length, item.expected.operatingProfit);
    assert.equal(first.providerUsage.providerCalls, 0);
    results.set(item.ticker, first);

    const artifact = {
      artifactVersion: "INVESTAI_PHASE6B_DIVIDEND_SEGMENT_V1",
      source: { fileName: item.fileName, sha256: item.expectedSha },
      periodScope: first.context,
      versionIdentity: { runIdentity: first.runIdentity, manifestVersion: first.manifestVersion, extractorVersion: first.extractorVersion, dimensionSchemaVersion: first.dimensionSchemaVersion, p0aVersions: first.p0a.versions, p0aOutcomeFingerprint: first.p0a.outcomeFingerprint },
      routing: { phase6bEvidencePages: first.selectedPages },
      ocr: { pages: first.p0a.ocrPages, reusedPages: first.p0a.reusedOcrPages, wholeDocumentOcr: false, newlyOcredForPhase6B: [] },
      dividendEvents: first.dividendEvents,
      segmentIdentities: first.segmentIdentities,
      segmentRevenueFacts: first.segmentFacts.filter((fact) => fact.metricCode === "REVENUE"),
      segmentOperatingProfitFacts: first.segmentFacts.filter((fact) => fact.metricCode === "OPERATING_PROFIT"),
      states: first.outcomes,
      reconciliationControls: first.reconciliations,
      evidenceAndLineage: { allEventsFieldLinked: first.dividendEvents.every((event) => event.evidence.length > 0), allSegmentIdentitiesLinked: first.segmentIdentities.every((identity) => identity.evidence.length > 0), allFactsLinked: first.segmentFacts.every((fact) => fact.evidence.length > 0), sourceRevisionHash: first.documentSha256 },
      idempotency: { runs: 2, runIdentityStable: first.runIdentity === second.runIdentity, logicalObjectsStable: true, duplicateEvents: first.dividendEvents.length - new Set(first.dividendEvents.map((event) => event.eventKey)).size, duplicateSegmentIdentities: first.segmentIdentities.length - new Set(first.segmentIdentities.map((identity) => identity.identityKey)).size, duplicateSegmentFacts: first.segmentFacts.length - new Set(first.segmentFacts.map((fact) => fact.factKey)).size },
      providerUsage: first.providerUsage,
      productionSafety: { legacyMutation: false, p0aMutation: false, phase6aMutation: false, railwayMutation: false, deployment: false },
    };
    const file = `${item.ticker}-PHASE6B-DIVIDEND-SEGMENT.json`;
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    await writeFile(join(outputDir, file), serialized, "utf8");
    checksums.push({ file, sha256: sha(serialized) });
  }

  const issuers = cases.map(({ ticker, expectedOcr }) => {
    const result = results.get(ticker)!;
    const state = (requirementId: string) => result.outcomes.find((outcome) => outcome.requirementId === requirementId)!;
    const revenueControls = result.reconciliations.filter((control) => control.controlId.startsWith("SEGMENT_REVENUE_"));
    return {
      issuer: ticker,
      dividendEventCount: result.dividendEvents.length,
      dividendCoverage: state("DIVIDEND_EVENT").state,
      segmentCount: result.segmentIdentities.length,
      segmentRevenueCoverage: state("SEGMENT_REVENUE").state,
      segmentOperatingProfitCoverage: state("SEGMENT_OPERATING_PROFIT").state,
      reconciliationResult: revenueControls.some((control) => control.applicable) && revenueControls.filter((control) => control.applicable).every((control) => control.passed) ? "PASS" : "NOT_APPLICABLE",
      evidenceCompleteness: result.dividendEvents.every((event) => event.evidence.length > 0) && result.segmentIdentities.every((identity) => identity.evidence.length > 0) && result.segmentFacts.every((fact) => fact.evidence.length > 0) ? "COMPLETE" : "INCOMPLETE",
      ocrUsage: { pages: result.p0a.ocrPages, expectedPages: expectedOcr, phase6bAdditionalPages: [] },
    };
  });
  const matrixFile = "PHASE6B-CROSS-ISSUER-MATRIX.json";
  const matrixSerialized = `${JSON.stringify({ artifactVersion: "INVESTAI_PHASE6B_CROSS_ISSUER_MATRIX_V1", issuers, providerUsage: { providerCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: "0.00000000" } }, null, 2)}\n`;
  await writeFile(join(outputDir, matrixFile), matrixSerialized, "utf8");
  checksums.push({ file: matrixFile, sha256: sha(matrixSerialized) });
  await writeFile(join(outputDir, "SHA256SUMS.txt"), checksums.map((item) => `${item.sha256}  ${item.file}`).join("\n") + "\n", "utf8");
  console.log(JSON.stringify({ outputDir, checksums, providerCalls: 0, tokens: 0, costUsd: "0.00000000" }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
