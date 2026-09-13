import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runP0ANativePipeline } from "../lib/financial/p0a/pipeline";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";

const EXPECTED_SHA = "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089";
const EXPECTED_PAGES = [4, 5, 6, 7, 8, 9, 10, 86, 88];

async function main() {
  const sourcePath = process.env.P0A_ICBP_PDF_PATH;
  if (!sourcePath) throw new Error("P0A_ICBP_PDF_PATH is required.");

  const context: P0AIssuerContext = {
    ticker: "ICBP",
    issuerType: "LISTED_COMMON_EQUITY",
    accountingModel: "NON_FINANCIAL",
    consolidated: true,
    audited: false,
    periodStart: "2025-01-01",
    periodEnd: "2025-06-30",
    periodType: "H1",
    currency: "IDR",
    documentScale: "1000000",
  };

  const bytes = await readFile(sourcePath);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sourceSha256, EXPECTED_SHA, "ICBP source checksum drifted");

  const result = await runP0ANativePipeline({ bytes, context });
  const count = (states: string[]) => result.outcomes.filter((outcome) => states.includes(outcome.state)).length;
  const counts = {
    valueZero: count(["VALUE", "ZERO"]),
    notApplicable: count(["NOT_APPLICABLE"]),
    notDisclosed: count(["NOT_DISCLOSED"]),
    missing: count(["MISSING"]),
    ambiguous: count(["AMBIGUOUS"]),
    conflict: count(["CONFLICT"]),
  };

  assert.equal(result.outcomes.length, 34, "ICBP must retain 34 P0-A outcomes");
  assert.deepEqual(result.selectedPages, EXPECTED_PAGES, "ICBP selected-page routing regressed");
  assert.deepEqual(counts, { valueZero: 28, notApplicable: 1, notDisclosed: 5, missing: 0, ambiguous: 0, conflict: 0 }, "ICBP semantic states regressed");
  assert.equal(result.usage.providerCalls, 0, "ICBP regression must remain native-only");
  assert.equal(result.usage.provider, null);
  assert.equal(result.usage.model, null);
  assert.equal(result.usage.inputTokens, null);
  assert.equal(result.usage.outputTokens, null);
  assert.equal(result.usage.estimatedCostUsd, null);
  assert.equal(result.usage.billedCostUsd, null);

  const output = {
    sourceSha256,
    pageCount: result.routedPages.length,
    ticker: context.ticker,
    period: "H1 2025",
    currency: context.currency,
    scale: context.documentScale,
    versions: result.versions,
    selectedPages: result.selectedPages,
    counts,
    providerUsage: result.usage,
    effectiveProviderUsage: { providerCalls: 0, inputTokens: 0, outputTokens: 0, apiCostUsd: "0.00000000" },
    outcomes: result.outcomes.map((outcome) => ({ requirementId: outcome.requirement.id, state: outcome.state })),
  };
  const outputDir = process.env.P0A_PHASE5_OUTPUT_DIR ?? "artifacts/phase5";
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "ICBP-PHASE5-REGRESSION-ACTUAL.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, ...output }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
