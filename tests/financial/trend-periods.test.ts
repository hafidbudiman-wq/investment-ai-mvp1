import assert from "node:assert/strict";
import test from "node:test";
import { comparableYoYGrowth, deriveStandaloneQuarter, isComparablePeriod, periodLabel } from "../../lib/financial/trend-periods";

test("YoY accepts only the same financial period in consecutive years", () => {
  assert.equal(isComparablePeriod({ year: 2025, periodType: "H1" }, { year: 2024, periodType: "H1" }), true);
  assert.equal(isComparablePeriod({ year: 2025, periodType: "H1" }, { year: 2024, periodType: "Q1" }), false);
  assert.equal(isComparablePeriod({ year: 2025, periodType: "FY" }, { year: 2023, periodType: "FY" }), false);
  assert.ok(Math.abs(comparableYoYGrowth(120, 100, { year: 2025, periodType: "H1" }, { year: 2024, periodType: "H1" })! - 0.2) < 1e-12);
  assert.equal(comparableYoYGrowth(120, 100, { year: 2025, periodType: "H1" }, { year: 2024, periodType: "Q1" }), null);
});

test("monthly YoY also requires the same ending month", () => {
  assert.equal(isComparablePeriod(
    { year: 2025, periodType: "MONTHLY", periodEnd: "2025-06-30" },
    { year: 2024, periodType: "MONTHLY", periodEnd: "2024-06-30" },
  ), true);
  assert.equal(isComparablePeriod(
    { year: 2025, periodType: "MONTHLY", periodEnd: "2025-06-30" },
    { year: 2024, periodType: "MONTHLY", periodEnd: "2024-05-31" },
  ), false);
});

test("standalone quarters derive only from the immediately preceding cumulative period", () => {
  assert.deepEqual(deriveStandaloneQuarter({ periodType: "Q1", value: 100 }), { quarter: "Q1", value: 100 });
  assert.deepEqual(deriveStandaloneQuarter({ periodType: "H1", value: 230 }, { periodType: "Q1", value: 100 }), { quarter: "Q2", value: 130 });
  assert.deepEqual(deriveStandaloneQuarter({ periodType: "Q3", value: 360 }, { periodType: "H1", value: 230 }), { quarter: "Q3", value: 130 });
  assert.deepEqual(deriveStandaloneQuarter({ periodType: "FY", value: 500 }, { periodType: "Q3", value: 360 }), { quarter: "Q4", value: 140 });
  assert.equal(deriveStandaloneQuarter({ periodType: "FY", value: 500 }, { periodType: "H1", value: 230 }), null);
  assert.equal(periodLabel("Q3"), "9M");
});
