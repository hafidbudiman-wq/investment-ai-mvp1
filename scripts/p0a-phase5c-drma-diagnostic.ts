import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { planOcrCompatibilityPages } from "../lib/financial/p0a/ocr-compatibility";
import { createLocalPageIndex } from "../lib/financial/p0a/page-index";
import { runP0ACompatiblePipeline, runP0ANativePipeline } from "../lib/financial/p0a/pipeline";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";

const EXPECTED_SHA = "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb";
const EXPECTED_PAGE_COUNT = 106;
const outputDir = process.env.P0A_PHASE5_OUTPUT_DIR ?? "artifacts/phase5";
const outputPath = path.join(outputDir, "DRMA-PHASE5C-OCR-DIAGNOSTIC.json");

async function writeArtifact(value: unknown) {
  await mkdir(outputDir, { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(outputPath, serialized, "utf8");
  console.log(`PHASE5C_DRMA_DIAGNOSTIC_SHA256=${createHash("sha256").update(serialized).digest("hex")}`);
}

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

  const index = await createLocalPageIndex(bytes);
  const native = await runP0ANativePipeline({ bytes, context, indexedPages: index });
  const unresolved = native.outcomes.filter((outcome) => outcome.state === "MISSING" || outcome.state === "CONFLICT").map((outcome) => outcome.requirementId);
  const planned = planOcrCompatibilityPages(index, native.routedPages, unresolved);
  const preflight = {
    imageOrInsufficientPages: index.filter((page) => page.contentClass === "IMAGE_ONLY" || page.contentClass === "INSUFFICIENT_TEXT").map((page) => ({ pageNumber: page.pageNumber, contentClass: page.contentClass, chars: page.text.length })),
    nativePrimaryPages: native.routedPages.filter((page) => page.pageClass.startsWith("PRIMARY_")).map((page) => ({ pageNumber: page.pageNumber, pageClass: page.pageClass, statementType: page.statementType })),
    unresolved, planned,
  };

  try {
    const result = await runP0ACompatiblePipeline({ bytes, context, indexedPages: index });
    assert.equal(result.routedPages.length, EXPECTED_PAGE_COUNT, "DRMA page-count drifted");
    assert.equal(result.outcomes.length, 34, "DRMA must retain frozen 34 P0-A requirements");
    assert.equal(result.usage.providerCalls, 0, "Phase 5C diagnostic must not call a provider");
    const count = (states: string[]) => result.outcomes.filter((outcome) => states.includes(outcome.state)).length;
    const counts = { valueZero: count(["VALUE", "ZERO"]), notApplicable: count(["NOT_APPLICABLE"]), notDisclosed: count(["NOT_DISCLOSED"]), missing: count(["MISSING"]), ambiguous: count(["AMBIGUOUS"]), conflict: count(["CONFLICT"]) };
    await writeArtifact({
      status: result.ocrUsage.ocrPages.length ? "OCR_EXECUTED" : "OCR_NOT_EXECUTED",
      artifactVersion: "INVESTAI_PHASE5C_OCR_DIAGNOSTIC_V2",
      source: { sha256: sourceSha256, pageCount: result.routedPages.length, ticker: context.ticker, issuer: "PT Dharma Polimetal Tbk", period: "FY 2025", currency: context.currency, scale: context.documentScale },
      preflight, versions: result.versions, ocrUsage: result.ocrUsage, selectedPages: result.selectedPages, counts, providerUsage: result.usage,
      pages: result.routedPages.filter((page) => page.sourceType === "OCR" || result.selectedPages.includes(page.pageNumber)).map((page) => ({ pageNumber: page.pageNumber, sourceType: page.sourceType ?? "NATIVE", contentClass: page.contentClass ?? null, extractionStatus: page.extractionStatus, pageClass: page.pageClass, statementType: page.statementType, textHash: page.textHash, layoutHash: page.layoutHash, ocr: page.sourceMetadata })),
      outcomes: result.outcomes.map((outcome) => ({ requirementId: outcome.requirementId, state: outcome.state, applicability: outcome.applicability, reason: outcome.reason, attemptedRoutes: outcome.attemptedRoutes, attemptedPages: outcome.attemptedPages, reportedObservation: outcome.reportedObservation, calculatedAlternative: outcome.calculatedAlternative })),
      validations: result.validations,
    });
    console.log(`PHASE5C_DRMA_OCR_PAGES=${JSON.stringify(result.ocrUsage.ocrPages)}`);
    console.log(`PHASE5C_DRMA_SELECTED_PAGES=${JSON.stringify(result.selectedPages)}`);
    console.log(`PHASE5C_DRMA_STATE_COUNTS=${JSON.stringify(counts)}`);
  } catch (error) {
    await writeArtifact({ status: "OCR_RUNTIME_ERROR", artifactVersion: "INVESTAI_PHASE5C_OCR_DIAGNOSTIC_V2", source: { sha256: sourceSha256, pageCount: index.length }, preflight, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) });
    console.error(error);
  }
}

main().catch(async (error) => { console.error(error); await writeArtifact({ status: "PREFLIGHT_ERROR", error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) }); });
