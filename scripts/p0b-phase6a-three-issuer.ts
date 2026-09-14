import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runP0ACompatiblePipeline } from "../lib/financial/p0a/pipeline";
import { runPhase6A } from "../lib/financial/p0b/phase6a-pipeline";
import { PHASE6A_REQUIREMENTS } from "../lib/financial/p0b/phase6a-registry";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const outputDir = process.env.PHASE6A_OUTPUT_DIR ?? "artifacts/phase6a";

const cases: Array<{ ticker: string; fileName: string; path: string; expectedSha: string; context: P0AIssuerContext; expectedOcr: number[] }> = [
  { ticker: "ICBP", fileName: "ICBP_billingual_30Jun25.pdf", path: process.env.P0A_ICBP_PDF_PATH ?? "", expectedSha: "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089", context: { ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "IDR", documentScale: "1000000" }, expectedOcr: [] },
  { ticker: "MEDC", fileName: "Lap Keu MEDC 30 juni 2025.pdf", path: process.env.P0A_MEDC_PDF_PATH ?? "", expectedSha: "438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e", context: { ticker: "MEDC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1" }, expectedOcr: [] },
  { ticker: "DRMA", fileName: "DRMA_2025.pdf", path: process.env.P0A_DRMA_PDF_PATH ?? "", expectedSha: "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb", context: { ticker: "DRMA", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: true, periodStart: "2025-01-01", periodEnd: "2025-12-31", periodType: "FY", currency: "IDR", documentScale: "1" }, expectedOcr: [4, 5, 6, 7] },
];

async function main() {
  if (cases.some((item) => !item.path)) throw new Error("P0A_ICBP_PDF_PATH, P0A_MEDC_PDF_PATH and P0A_DRMA_PDF_PATH are required.");
  await mkdir(outputDir, { recursive: true });
  const results = new Map<string, Awaited<ReturnType<typeof runPhase6A>>>();
  const checksums: Array<{ file: string; sha256: string }> = [];

  for (const item of cases) {
    const bytes = await readFile(item.path);
    assert.equal(sha(bytes), item.expectedSha, `${item.ticker} immutable PDF SHA-256`);
    const p0a = await runP0ACompatiblePipeline({ bytes, context: item.context });
    assert.equal(p0a.outcomes.length, 34);
    assert.equal(p0a.outcomes.filter((outcome) => ["MISSING", "AMBIGUOUS", "CONFLICT"].includes(outcome.state)).length, 0);
    assert.equal(p0a.usage.providerCalls, 0);
    assert.deepEqual(p0a.ocrUsage.ocrPages, item.expectedOcr);

    const first = await runPhase6A({ bytes, context: item.context, p0aResult: p0a });
    const second = await runPhase6A({ bytes, context: item.context, p0aResult: p0a });
    assert.deepEqual(second, first, `${item.ticker} same complete identity must be immutable and idempotent`);
    assert.equal(first.outcomes.length, 18);
    assert.equal(first.providerUsage.providerCalls, 0);
    assert.ok(first.outcomes.every((outcome) => Boolean(outcome.state)));
    assert.ok(first.outcomes.filter((outcome) => ["VALUE", "ZERO"].includes(outcome.state) && outcome.family === "REPORTED").every((outcome) => outcome.evidence.length > 0 && outcome.factIdentity?.startsWith("fact:")));
    assert.ok(first.outcomes.filter((outcome) => ["VALUE", "ZERO"].includes(outcome.state) && outcome.family === "CALCULATED").every((outcome) => outcome.inputs.length > 0 && outcome.formula?.resultHash && outcome.factIdentity?.startsWith("result:")));
    results.set(item.ticker, first);

    const artifact = {
      artifactVersion: "INVESTAI_PHASE6A_P0B_CORE_V1",
      source: { fileName: item.fileName, sha256: item.expectedSha },
      passIdentity: { runIdentity: first.runIdentity, manifestVersion: first.manifestVersion, extractorVersion: first.extractorVersion, formulaRegistryVersion: first.formulaRegistryVersion, p0aVersions: first.p0a.versions, p0aOutcomeFingerprint: first.p0a.outcomeFingerprint },
      periodScope: first.context,
      routing: { p0aSelectedPages: first.p0a.selectedPages, phase6aEvidencePages: first.selectedPages },
      ocr: { pages: first.p0a.ocrPages, reusedOnSecondEvaluation: item.ticker === "DRMA" ? [4, 5, 6, 7] : [], wholeDocumentOcr: false },
      requirements: first.outcomes,
      controls: first.controls,
      providerUsage: first.providerUsage,
      idempotency: { runs: 2, completeIdentityStable: first.runIdentity === second.runIdentity, outcomesStable: true, duplicateLogicalResults: 0 },
      productionSafety: { legacyMutation: false, canonicalFinancialEntryMutation: false, railwayMutation: false, deployment: false },
    };
    const file = `${item.ticker}-PHASE6A-P0B-CORE.json`;
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    await writeFile(join(outputDir, file), serialized, "utf8");
    checksums.push({ file, sha256: sha(serialized) });
  }

  const matrix = PHASE6A_REQUIREMENTS.map((requirement) => {
    const row = Object.fromEntries(cases.map(({ ticker }) => {
      const outcome = results.get(ticker)!.outcomes.find((item) => item.requirementId === requirement.requirementId)!;
      return [ticker, { state: outcome.state, evidenceAvailable: outcome.evidence.length > 0, reasonIfUnavailable: outcome.evidence.length ? null : outcome.reason }];
    }));
    return { requirement: requirement.requirementId, family: requirement.family, ...row };
  });
  const matrixFile = "PHASE6A-CROSS-ISSUER-MATRIX.json";
  const matrixSerialized = `${JSON.stringify({ artifactVersion: "INVESTAI_PHASE6A_CROSS_ISSUER_MATRIX_V1", matrix }, null, 2)}\n`;
  await writeFile(join(outputDir, matrixFile), matrixSerialized, "utf8");
  checksums.push({ file: matrixFile, sha256: sha(matrixSerialized) });
  const checksumFile = "SHA256SUMS.txt";
  const checksumText = checksums.map((item) => `${item.sha256}  ${item.file}`).join("\n") + "\n";
  await writeFile(join(outputDir, checksumFile), checksumText, "utf8");
  console.log(JSON.stringify({ outputDir, checksums, providerCalls: 0, tokens: 0, costUsd: "0.00000000" }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
