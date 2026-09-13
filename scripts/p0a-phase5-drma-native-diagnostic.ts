import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runP0ANativePipeline } from "../lib/financial/p0a/pipeline";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";

const EXPECTED_SHA = "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb";
const EXPECTED_PAGE_COUNT = 106;
const CRITICAL_PRIMARY_PAGES = [4, 5, 6, 7];

async function main() {
  const sourcePath = process.env.P0A_DRMA_PDF_PATH;
  if (!sourcePath) throw new Error("P0A_DRMA_PDF_PATH is required.");

  const context: P0AIssuerContext = {
    ticker: "DRMA",
    issuerType: "LISTED_COMMON_EQUITY",
    accountingModel: "NON_FINANCIAL",
    consolidated: true,
    audited: true,
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    periodType: "FY",
    currency: "IDR",
    documentScale: "1",
  };

  const bytes = await readFile(sourcePath);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sourceSha256, EXPECTED_SHA, "DRMA source checksum drifted");

  const result = await runP0ANativePipeline({ bytes, context });
  assert.equal(result.routedPages.length, EXPECTED_PAGE_COUNT, "DRMA page-count drifted");
  assert.equal(result.usage.providerCalls, 0, "DRMA native diagnostic must not call a provider");

  const count = (states: string[]) => result.outcomes.filter((outcome) => states.includes(outcome.state)).length;
  const counts = {
    valueZero: count(["VALUE", "ZERO"]),
    notApplicable: count(["NOT_APPLICABLE"]),
    notDisclosed: count(["NOT_DISCLOSED"]),
    missing: count(["MISSING"]),
    ambiguous: count(["AMBIGUOUS"]),
    conflict: count(["CONFLICT"]),
  };
  const criticalPages = CRITICAL_PRIMARY_PAGES.map((pageNumber) => {
    const page = result.routedPages.find((item) => item.pageNumber === pageNumber);
    return {
      pageNumber,
      extractionStatus: page?.extractionStatus ?? null,
      pageClass: page?.pageClass ?? null,
      statementType: page?.statementType ?? null,
      nativeCharacters: page?.text.length ?? 0,
    };
  });
  const emptyCriticalPages = criticalPages.filter((page) => page.extractionStatus === "EMPTY" || page.nativeCharacters === 0).map((page) => page.pageNumber);
  const primaryPages = result.routedPages.filter((page) => page.pageClass.startsWith("PRIMARY_")).map((page) => ({ pageNumber: page.pageNumber, pageClass: page.pageClass, statementType: page.statementType }));
  const missingCore = result.outcomes.filter((outcome) => outcome.state === "MISSING").map((outcome) => outcome.requirementId);
  const architectureBlocker = emptyCriticalPages.length >= 3 && missingCore.length > 0;

  const output = {
    status: architectureBlocker ? "ARCHITECTURE_BLOCKER" : "NATIVE_DIAGNOSTIC_COMPLETE",
    blockerReason: architectureBlocker
      ? "Critical primary financial-statement pages contain no native PDF text. The frozen native-first parser cannot truthfully recover required reported facts without adding an OCR/image-text parsing capability."
      : null,
    source: {
      sha256: sourceSha256,
      pageCount: result.routedPages.length,
      issuer: "PT Dharma Polimetal Tbk",
      ticker: context.ticker,
      period: "FY 2025",
      consolidated: true,
      audited: true,
      currency: context.currency,
      scale: context.documentScale,
    },
    versions: result.versions,
    criticalPrimaryPages: criticalPages,
    emptyCriticalPages,
    routedPrimaryPages: primaryPages,
    selectedPages: result.selectedPages,
    counts,
    missingRequirements: missingCore,
    providerUsage: result.usage,
    effectiveProviderUsage: { providerCalls: 0, inputTokens: 0, outputTokens: 0, apiCostUsd: "0.00000000" },
    outcomes: result.outcomes.map((outcome) => ({
      requirementId: outcome.requirementId,
      state: outcome.state,
      reason: outcome.reason,
      attemptedRoutes: outcome.attemptedRoutes,
      attemptedPages: outcome.attemptedPages,
      reportedObservation: outcome.reportedObservation,
      calculatedAlternative: outcome.calculatedAlternative,
    })),
  };

  const outputDir = process.env.P0A_PHASE5_OUTPUT_DIR ?? "artifacts/phase5";
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "DRMA-PHASE5-P0A-ACTUAL.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, ...output }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
