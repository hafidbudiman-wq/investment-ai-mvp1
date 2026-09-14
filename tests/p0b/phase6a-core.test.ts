import assert from "node:assert/strict";
import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";
import { PHASE6A_FORMULA_BY_CODE, PHASE6A_REQUIREMENTS } from "../../lib/financial/p0b/phase6a-registry";
import { runPhase6A } from "../../lib/financial/p0b/phase6a-pipeline";

const read = promisify(readFile);

test("Phase 6A registry contains exactly the approved 18 typed requirements", () => {
  assert.equal(PHASE6A_REQUIREMENTS.length, 18);
  assert.equal(new Set(PHASE6A_REQUIREMENTS.map((item) => item.canonicalCode)).size, 18);
  assert.equal(PHASE6A_REQUIREMENTS.find((item) => item.canonicalCode === "SHARES_OUTSTANDING_REPORTED")?.family, "REPORTED");
  assert.equal(PHASE6A_REQUIREMENTS.some((item) => item.canonicalCode === "SHARES_OUTSTANDING_CALCULATED"), false);
});

test("reported and calculated definitions never collapse", () => {
  for (const concept of ["TOTAL_DEBT", "LEASE_LIABILITIES", "SGA", "EBITDA", "CAPEX_TOTAL_CASH"]) {
    const variants = PHASE6A_REQUIREMENTS.filter((item) => item.canonicalCode.startsWith(concept));
    assert.equal(variants.some((item) => item.family === "REPORTED"), true, concept);
    assert.equal(variants.some((item) => item.family === "CALCULATED"), true, concept);
    assert.notEqual(variants.find((item) => item.family === "REPORTED")?.canonicalCode, variants.find((item) => item.family === "CALCULATED")?.canonicalCode);
  }
});

test("locked formulas expose semantic versions and exact roles", () => {
  assert.deepEqual(PHASE6A_FORMULA_BY_CODE.get("TOTAL_DEBT_CALCULATED")?.inputRoles, ["ACCEPTED_SHORT_TERM_DEBT_EX_LEASE_COMPONENTS", "ACCEPTED_LONG_TERM_DEBT_EX_LEASE_COMPONENTS", "LEASE_LIABILITIES_TOTAL"]);
  assert.equal(PHASE6A_FORMULA_BY_CODE.get("FCF_CALCULATED")?.expression, "OCF_REPORTED + SIGNED_CAPEX_TOTAL_CASH");
  assert.equal(PHASE6A_FORMULA_BY_CODE.has("EBITDA_CALCULATED"), false, "Undefined frozen EBITDA formula must fail closed.");
});

test("Phase 6A production source contains no issuer, page, or gold-value hardcoding", () => {
  const source = readFileSync("lib/financial/p0b/phase6a-pipeline.ts", "utf8");
  assert.doesNotMatch(source, /ICBP|MEDC|DRMA|Indofood|Medco|Dharma\s+Polimetal/i);
  assert.doesNotMatch(source, /pageNumber\s*={2,3}\s*\d+|2[.,]396[.,]085|213[.,]075[.,]976|610[.,]058[.,]582[.,]694/i);
});

const cases = [
  { ticker: "ICBP", env: "P0A_ICBP_PDF_PATH", context: { ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "IDR", documentScale: "1000000" }, expected: { fcf: "2396085", debt: "45818859", capex: "-2447972", oci: "-273353", interest: null, ocr: [] } },
  { ticker: "MEDC", env: "P0A_MEDC_PDF_PATH", context: { ticker: "MEDC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1" }, expected: { fcf: "213075976", debt: "3735874708", capex: "-185274393", oci: null, interest: null, ocr: [] } },
  { ticker: "DRMA", env: "P0A_DRMA_PDF_PATH", context: { ticker: "DRMA", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: true, periodStart: "2025-01-01", periodEnd: "2025-12-31", periodType: "FY", currency: "IDR", documentScale: "1" }, expected: { fcf: "610058582694", debt: "278683993522", capex: "-313970875677", oci: "-1592457184", interest: "32135649832", ocr: [4, 5, 6, 7] } },
] as const;

for (const item of cases) test(`${item.ticker} Phase 6A source regression`, { skip: !process.env[item.env] }, async () => {
  const result = await runPhase6A({ bytes: await read(process.env[item.env]!), context: item.context });
  const value = (code: string) => result.outcomes.find((outcome) => outcome.canonicalCode === code)?.value;
  assert.equal(result.outcomes.length, 18);
  assert.equal(value("FCF_CALCULATED"), item.expected.fcf);
  assert.equal(value("TOTAL_DEBT_CALCULATED"), item.expected.debt);
  assert.equal(value("CAPEX_TOTAL_CASH_CALCULATED"), item.expected.capex);
  assert.equal(value("OCI_TOTAL_REPORTED"), item.expected.oci);
  assert.equal(result.outcomes.find((outcome) => outcome.canonicalCode === "OCI_TOTAL_REPORTED")?.state, item.expected.oci === null ? "MISSING" : "VALUE");
  assert.equal(value("INTEREST_EXPENSE_REPORTED"), item.expected.interest);
  assert.equal(result.outcomes.find((outcome) => outcome.canonicalCode === "SHARES_OUTSTANDING_REPORTED")?.state, "MISSING");
  assert.equal(result.outcomes.find((outcome) => outcome.canonicalCode === "EBITDA_CALCULATED")?.state, "NOT_CALCULABLE");
  for (const outcome of result.outcomes.filter((candidate) => candidate.family === "CALCULATED" && ["VALUE", "ZERO"].includes(candidate.state))) {
    assert.ok(outcome.formula?.formulaVersion);
    assert.ok(outcome.formula?.resultHash);
    assert.ok(outcome.inputs.length > 0);
    assert.ok(outcome.inputs.every((formulaInput) => formulaInput.inputId && formulaInput.value && formulaInput.evidence.length > 0));
  }
  assert.ok(result.controls.filter((control) => control.applicable).every((control) => control.passed === true));
  assert.deepEqual(result.p0a.ocrPages, [...item.expected.ocr]);
  assert.equal(result.providerUsage.providerCalls, 0);
});
