import assert from "node:assert/strict";
import test from "node:test";
import { applyCompanyFallback, companyFromFileName } from "../../lib/financial/company-fallback";

const companies = [
  { ticker: "MEDC", name: "Medco Energi Internasional Tbk" },
  { ticker: "ICBP", name: "Indofood CBP Sukses Makmur Tbk" },
];

test("resolves one exact ticker token from a financial-statement filename", () => {
  assert.deepEqual(companyFromFileName("Lap Keu MEDC 30 juni 2025.pdf", companies), companies[0]);
  assert.equal(companyFromFileName("laporan-keuangan.pdf", companies), null);
});

test("fills missing AI issuer metadata only when deterministic evidence agrees", () => {
  const filled = applyCompanyFallback({
    detectedCompanyTicker: null,
    detectedCompanyName: null,
    detectedCompanyConfidence: 1,
  }, companies[0]) as Record<string, unknown>;
  assert.equal(filled.detectedCompanyTicker, "MEDC");
  assert.equal(filled.detectedCompanyName, "Medco Energi Internasional Tbk");

  const conflict = { detectedCompanyTicker: "ICBP", detectedCompanyName: null, detectedCompanyConfidence: 1 };
  assert.deepEqual(applyCompanyFallback(conflict, companies[0]), conflict);
});
