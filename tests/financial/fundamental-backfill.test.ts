import assert from "node:assert/strict";
import test from "node:test";
import { FUNDAMENTAL_BACKFILL_DATASETS, factsByCode } from "../../lib/financial/fundamental-backfill-data";

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * tolerance, `${actual} != ${expected}`);
}

test("three approved PDFs have checksum-locked, unique, fundamental-ready facts", () => {
  assert.deepEqual(FUNDAMENTAL_BACKFILL_DATASETS.map((item) => item.ticker), ["ICBP", "DRMA", "MEDC"]);
  for (const dataset of FUNDAMENTAL_BACKFILL_DATASETS) {
    assert.match(dataset.checksum, /^[a-f0-9]{64}$/);
    assert.ok(dataset.facts.length >= 45, `${dataset.ticker} should expose at least 45 facts`);
    assert.equal(new Set(dataset.facts.map((item) => item.code)).size, dataset.facts.length);
    assert.ok(dataset.facts.every((item) => item.sourcePage > 0));
  }
});

for (const dataset of FUNDAMENTAL_BACKFILL_DATASETS) {
  test(`${dataset.ticker} reconciles balance sheet, equity, debt, shares, gross profit, EPS, and FCF`, () => {
    const facts = factsByCode(dataset);
    const value = (code: string) => {
      const item = facts.get(code);
      assert.ok(item, `${dataset.ticker} missing ${code}`);
      return item.value;
    };

    close(value("TOTAL_ASSETS"), value("TOTAL_LIAB") + value("EQUITY"));
    close(value("EQUITY"), value("EQUITY_PARENT") + value("NCI"));
    close(value("TOTAL_DEBT"), value("SHORT_TERM_DEBT") + value("LONG_TERM_DEBT") + value("LEASE_LIABILITIES"));
    close(value("SHARES_OUTSTANDING"), value("SHARES_ISSUED") - value("TREASURY_SHARES"));
    close(value("GROSS_PROFIT"), value("REV") - value("COGS"));
    close(value("FCF"), value("OCF") + value("CAPEX"));

    const normalizedProfit = value("NET_PROFIT_PARENT") * dataset.unitScale;
    const calculatedEps = normalizedProfit / value("WEIGHTED_AVG_SHARES");
    const reportedEps = value("EPS_BASIC");
    assert.ok(Math.abs(calculatedEps - reportedEps) / Math.abs(reportedEps) < 0.01, `${dataset.ticker} EPS rounding is outside 1%`);
  });
}

test("MEDC keeps operating profit absent instead of inventing a subtotal", () => {
  const medc = FUNDAMENTAL_BACKFILL_DATASETS.find((item) => item.ticker === "MEDC")!;
  assert.equal(factsByCode(medc).has("OPERATING_PROFIT"), false);
});

test("document units are preserved while shares and EPS remain unit values", () => {
  const icbp = FUNDAMENTAL_BACKFILL_DATASETS.find((item) => item.ticker === "ICBP")!;
  const drma = FUNDAMENTAL_BACKFILL_DATASETS.find((item) => item.ticker === "DRMA")!;
  const medc = FUNDAMENTAL_BACKFILL_DATASETS.find((item) => item.ticker === "MEDC")!;
  assert.equal(icbp.unitScale, 1_000_000);
  assert.equal(drma.unitScale, 1);
  assert.equal(medc.unitScale, 1);
  assert.equal(factsByCode(icbp).get("SHARES_OUTSTANDING")?.currency, "SHARES");
  assert.equal(factsByCode(medc).get("SHARES_OUTSTANDING")?.value, 24_683_001_744);
});
