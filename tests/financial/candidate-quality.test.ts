import assert from "node:assert/strict";
import test from "node:test";
import { ensureCandidateBackedChunks, refineFinancialCandidates } from "../../lib/financial/candidate-quality";
import type { ValidatedFinancialExtraction } from "../../lib/financial/extraction-schema";

const candidate = (reportedLabel: string, numericValue: number, statementType: "BALANCE_SHEET" | "CASH_FLOW", canonicalCode: string | null = null) => ({
  statementType,
  reportedLabel,
  rawValue: String(numericValue),
  numericValue,
  currency: "USD",
  scale: 1,
  sourcePage: statementType === "BALANCE_SHEET" ? 6 : 13,
  sourceText: reportedLabel,
  canonicalCode,
  extractionConfidence: 0.99,
  mappingConfidence: canonicalCode ? 0.95 : 0,
});

function extraction(candidates: ValidatedFinancialExtraction["candidates"]): ValidatedFinancialExtraction {
  return {
    detectedCompanyTicker: "MEDC",
    detectedCompanyName: "Medco Energi Internasional Tbk",
    detectedCompanyConfidence: 1,
    detectedYear: 2025,
    detectedPeriodType: "H1",
    detectedPeriodConfidence: 1,
    detectedCurrency: "USD",
    detectedUnitScale: 1,
    pageCount: 120,
    chunks: [{ section: "Statements", chunkType: "TABLE", pageStart: 5, pageEnd: 13, textSummary: "Primary statements" }],
    candidates,
  };
}

test("derives total debt including current and non-current lease liabilities", () => {
  const refined = refineFinancialCandidates(extraction([
    candidate("Short-term bank loans", 15, "BALANCE_SHEET"),
    candidate("Current maturities of bank loans", 118, "BALANCE_SHEET"),
    candidate("Non-current bank loans", 1106, "BALANCE_SHEET"),
    candidate("Current lease liabilities", 106, "BALANCE_SHEET"),
    candidate("Non-current lease liabilities", 172, "BALANCE_SHEET"),
    candidate("Total debt - lease liabilities excluded", 1239, "BALANCE_SHEET", "TOTAL_DEBT"),
  ]));
  const total = refined.candidates.find((item) => item.canonicalCode === "TOTAL_DEBT");
  assert.equal(total?.numericValue, 1517);
  assert.match(total?.sourceText ?? "", /lease liabilities/i);
});

test("recognizes Indonesian utang bank labels used by DRMA", () => {
  const refined = refineFinancialCandidates(extraction([
    candidate("Utang bank jangka pendek", 104_392_088_215, "BALANCE_SHEET"),
    candidate("Bagian utang bank jangka panjang yang jatuh tempo dalam satu tahun", 68_557_536_186, "BALANCE_SHEET"),
    candidate("Liabilitas sewa - jangka pendek", 115_720_054, "BALANCE_SHEET"),
    candidate("Utang bank jangka panjang, setelah dikurangi bagian jatuh tempo", 105_607_150_517, "BALANCE_SHEET"),
    candidate("Liabilitas sewa - jangka panjang", 11_498_550, "BALANCE_SHEET"),
  ]));
  assert.equal(refined.candidates.find((item) => item.canonicalCode === "TOTAL_DEBT")?.numericValue, 278_683_993_522);
});

test("derives sector-aware capex and FCF with canonical signs", () => {
  const refined = refineFinancialCandidates(extraction([
    candidate("Net cash provided by operating activities", 398, "CASH_FLOW", "OCF"),
    candidate("Acquisitions of property, plant and equipment", -7, "CASH_FLOW", "CAPEX"),
    candidate("Additions to oil and gas properties", -164, "CASH_FLOW"),
    candidate("Addition to exploration and evaluation assets", -10, "CASH_FLOW"),
  ]));
  assert.equal(refined.candidates.find((item) => item.canonicalCode === "CAPEX")?.numericValue, -181);
  assert.equal(refined.candidates.find((item) => item.canonicalCode === "FCF")?.numericValue, 217);
});

test("removes unsafe debt mapping when evidence says leases were excluded", () => {
  const unsafe = candidate("Total debt", 100, "BALANCE_SHEET", "TOTAL_DEBT");
  unsafe.sourceText = "Lease liabilities excluded.";
  const refined = refineFinancialCandidates(extraction([unsafe]));
  assert.equal(refined.candidates[0].canonicalCode, null);
  assert.equal(refined.candidates[0].mappingConfidence, 0);
});

test("keeps one canonical AR total when counterparties reconcile exactly", () => {
  const related = candidate("Piutang usaha - pihak berelasi", 10, "BALANCE_SHEET", "AR");
  const third = candidate("Piutang usaha - pihak ketiga", 90, "BALANCE_SHEET", "AR");
  const total = candidate("Piutang usaha - jumlah neto", 100, "BALANCE_SHEET", "AR");
  const refined = refineFinancialCandidates(extraction([related, third, total]));
  assert.equal(refined.candidates.filter((item) => item.canonicalCode === "AR").length, 1);
  assert.equal(refined.candidates.find((item) => item.canonicalCode === "AR")?.numericValue, 100);
  assert.equal(refined.candidates.filter((item) => item.canonicalCode === null).length, 2);
});

test("does not hide AR components when the proposed total does not reconcile", () => {
  const related = candidate("Trade receivables - related parties", 10, "BALANCE_SHEET", "AR");
  const third = candidate("Trade receivables - third parties", 90, "BALANCE_SHEET", "AR");
  const total = candidate("Trade receivables - total net", 120, "BALANCE_SHEET", "AR");
  const refined = refineFinancialCandidates(extraction([related, third, total]));
  assert.equal(refined.candidates.filter((item) => item.canonicalCode === "AR").length, 3);
});

test("reconstructs a fallback chunk from page-traced candidates", () => {
  const raw = extraction([candidate("Revenue", 100, "CASH_FLOW", "REV")]);
  raw.chunks = [];
  raw.candidates[0].sourcePage = 8;
  const repaired = ensureCandidateBackedChunks(raw) as ValidatedFinancialExtraction;
  assert.equal(repaired.chunks.length, 1);
  assert.equal(repaired.chunks[0].pageStart, 8);
  assert.equal(repaired.chunks[0].pageEnd, 8);
});

test("does not disguise an empty extraction as a valid chunk", () => {
  const raw = extraction([]);
  raw.chunks = [];
  const unchanged = ensureCandidateBackedChunks(raw) as ValidatedFinancialExtraction;
  assert.equal(unchanged.chunks.length, 0);
});
