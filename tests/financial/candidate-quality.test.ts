import assert from "node:assert/strict";
import test from "node:test";
import { refineFinancialCandidates } from "../../lib/financial/candidate-quality";
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
