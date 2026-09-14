import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runP0ACompatiblePipeline } from "../lib/financial/p0a/pipeline";

function sha(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
function counts(result: Awaited<ReturnType<typeof runP0ACompatiblePipeline>>) {
  return {
    valueZero: result.outcomes.filter((item) => item.state === "VALUE" || item.state === "ZERO").length,
    notApplicable: result.outcomes.filter((item) => item.state === "NOT_APPLICABLE").length,
    notDisclosed: result.outcomes.filter((item) => item.state === "NOT_DISCLOSED").length,
    missing: result.outcomes.filter((item) => item.state === "MISSING").length,
    ambiguous: result.outcomes.filter((item) => item.state === "AMBIGUOUS").length,
    conflict: result.outcomes.filter((item) => item.state === "CONFLICT").length,
  };
}

async function main() {
  const icbpPath = process.env.P0A_ICBP_PDF_PATH;
  const medcPath = process.env.P0A_MEDC_PDF_PATH;
  if (!icbpPath || !medcPath) throw new Error("P0A_ICBP_PDF_PATH and P0A_MEDC_PDF_PATH are required.");

  const icbpBytes = await readFile(icbpPath);
  assert.equal(sha(icbpBytes), "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089");
  const icbp = await runP0ACompatiblePipeline({ bytes: icbpBytes, context: {
    ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false,
    periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "IDR", documentScale: "1000000",
  } });
  assert.deepEqual(icbp.selectedPages, [4,5,6,7,8,9,10,86,88]);
  assert.deepEqual(counts(icbp), { valueZero: 28, notApplicable: 1, notDisclosed: 5, missing: 0, ambiguous: 0, conflict: 0 });
  assert.deepEqual(icbp.ocrUsage.ocrPages, [], "ICBP must not execute OCR.");
  assert.equal(icbp.routedPages.filter((page) => page.sourceType === "OCR").length, 0, "ICBP must remain native-only.");
  assert.equal(icbp.usage.providerCalls, 0);

  const medcBytes = await readFile(medcPath);
  assert.equal(sha(medcBytes), "438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e");
  const medc = await runP0ACompatiblePipeline({ bytes: medcBytes, context: {
    ticker: "MEDC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false,
    periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1",
  } });
  assert.deepEqual(medc.selectedPages, [5,6,7,8,9,10,11,12,13,14,39,218,220]);
  assert.deepEqual(counts(medc), { valueZero: 27, notApplicable: 1, notDisclosed: 6, missing: 0, ambiguous: 0, conflict: 0 });
  assert.deepEqual(medc.ocrUsage.ocrPages, [], "MEDC must not execute OCR.");
  assert.equal(medc.routedPages.filter((page) => page.sourceType === "OCR").length, 0, "MEDC must remain native-only.");
  assert.equal(medc.usage.providerCalls, 0);

  console.log(`PHASE5C_NATIVE_PROOF=${JSON.stringify({
    ICBP: { ocrPages: icbp.ocrUsage.ocrPages, selectedPages: icbp.selectedPages, counts: counts(icbp), currency: "IDR", scale: "1000000" },
    MEDC: { ocrPages: medc.ocrUsage.ocrPages, selectedPages: medc.selectedPages, counts: counts(medc), currency: "USD", scale: "1" },
  })}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
