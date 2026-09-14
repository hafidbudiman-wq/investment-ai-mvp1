import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runP0ACompatiblePipeline } from "../lib/financial/p0a/pipeline";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";

const EXPECTED_SHA = "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb";
const EXPECTED_PAGE_COUNT = 106;

async function main() {
  const sourcePath = process.env.P0A_DRMA_PDF_PATH;
  if (!sourcePath) throw new Error("P0A_DRMA_PDF_PATH is required.");
  const context: P0AIssuerContext = {
    ticker: "DRMA", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL",
    consolidated: true, audited: true, periodStart: "2025-01-01", periodEnd: "2025-12-31",
    periodType: "FY", currency: "IDR", documentScale: "1",
  };
  const bytes = await readFile(sourcePath);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sourceSha256, EXPECTED_SHA, "DRMA source checksum drifted");
  const result = await runP0ACompatiblePipeline({ bytes, context });
  assert.equal(result.routedPages.length, EXPECTED_PAGE_COUNT, "DRMA page-count drifted");
  assert.equal(result.outcomes.length, 34, "DRMA must retain frozen 34 P0-A requirements");
  assert.equal(result.usage.providerCalls, 0, "Phase 5C diagnostic must not call a provider");
  assert.ok(result.ocrUsage.ocrPages.length > 0, "DRMA must prove OCR fallback was needed");

  const count = (states: string[]) => result.outcomes.filter((outcome) => states.includes(outcome.state)).length;
  const counts = {
    valueZero: count(["VALUE", "ZERO"]), notApplicable: count(["NOT_APPLICABLE"]), notDisclosed: count(["NOT_DISCLOSED"]),
    missing: count(["MISSING"]), ambiguous: count(["AMBIGUOUS"]), conflict: count(["CONFLICT"]),
  };
  const artifact = {
    artifactVersion: "INVESTAI_PHASE5C_OCR_DIAGNOSTIC_V1",
    source: { sha256: sourceSha256, pageCount: result.routedPages.length, ticker: context.ticker, issuer: "PT Dharma Polimetal Tbk", period: "FY 2025", currency: context.currency, scale: context.documentScale },
    versions: result.versions, ocrUsage: result.ocrUsage, selectedPages: result.selectedPages, counts, providerUsage: result.usage,
    pages: result.routedPages.filter((page) => page.sourceType === "OCR" || result.selectedPages.includes(page.pageNumber)).map((page) => ({
      pageNumber: page.pageNumber, sourceType: page.sourceType ?? "NATIVE", contentClass: page.contentClass ?? null,
      extractionStatus: page.extractionStatus, pageClass: page.pageClass, statementType: page.statementType,
      textHash: page.textHash, layoutHash: page.layoutHash, ocr: page.sourceMetadata,
    })),
    outcomes: result.outcomes.map((outcome) => ({
      requirementId: outcome.requirementId, state: outcome.state, applicability: outcome.applicability, reason: outcome.reason,
      attemptedRoutes: outcome.attemptedRoutes, attemptedPages: outcome.attemptedPages,
      reportedObservation: outcome.reportedObservation, calculatedAlternative: outcome.calculatedAlternative,
    })),
    validations: result.validations,
  };
  const outputDir = process.env.P0A_PHASE5_OUTPUT_DIR ?? "artifacts/phase5";
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "DRMA-PHASE5C-OCR-DIAGNOSTIC.json");
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(outputPath, serialized, "utf8");
  console.log(`PHASE5C_DRMA_OCR_PAGES=${JSON.stringify(result.ocrUsage.ocrPages)}`);
  console.log(`PHASE5C_DRMA_SELECTED_PAGES=${JSON.stringify(result.selectedPages)}`);
  console.log(`PHASE5C_DRMA_STATE_COUNTS=${JSON.stringify(counts)}`);
  console.log(`PHASE5C_DRMA_DIAGNOSTIC_SHA256=${createHash("sha256").update(serialized).digest("hex")}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
