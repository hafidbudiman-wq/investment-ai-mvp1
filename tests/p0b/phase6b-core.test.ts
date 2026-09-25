import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runPhase6B } from "../../lib/financial/p0b/phase6b-pipeline";
import type { P0AIssuerContext } from "../../lib/financial/p0a/types";

test("Phase 6B implementation is generic and additive", async () => {
  const root = process.cwd();
  const sources = await Promise.all([
    "lib/financial/p0b/phase6b-pipeline.ts",
    "lib/financial/p0b/phase6b-persistence.ts",
  ].map((file) => readFile(join(root, file), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /ICBP|MEDC|DRMA|Indofood|Medco|Dharma\s+Polimetal/i);
  const migration = await readFile(join(root, "prisma/migrations/20260925190000_phase6b_dividend_segment/migration.sql"), "utf8");
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN/i);
  assert.match(migration, /CREATE TABLE "DividendEvent"/);
  assert.match(migration, /CREATE TABLE "SegmentDimension"/);
  assert.match(migration, /CREATE TABLE "SegmentFact"/);
});

const cases: Array<{
  ticker: string;
  env: string;
  context: P0AIssuerContext;
  expected: {
    ocr: number[];
    eventPage: number;
    paymentEvidencePage?: number;
    eventType: string;
    total: string;
    totalCurrency: string;
    perShare: string;
    perShareCurrency: string;
    approval: string;
    payment: string | null;
    segmentPage: number;
    segments: number;
    revenue: number;
    operatingProfit: number;
  };
}> = [
  { ticker: "ICBP", env: "P0A_ICBP_PDF_PATH", context: { ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "IDR", documentScale: "1000000" }, expected: { ocr: [], eventPage: 88, eventType: "FINAL", total: "2915477000000", totalCurrency: "IDR", perShare: "250", perShareCurrency: "IDR", approval: "2025-06-20", payment: null, segmentPage: 93, segments: 8, revenue: 24, operatingProfit: 8 } },
  { ticker: "MEDC", env: "P0A_MEDC_PDF_PATH", context: { ticker: "MEDC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1" }, expected: { ocr: [], eventPage: 220, eventType: "FINAL", total: "37923889", totalCurrency: "USD", perShare: "25", perShareCurrency: "IDR", approval: "2025-06-03", payment: "2025-07-04", segmentPage: 239, segments: 8, revenue: 24, operatingProfit: 0 } },
  { ticker: "DRMA", env: "P0A_DRMA_PDF_PATH", context: { ticker: "DRMA", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: true, periodStart: "2025-01-01", periodEnd: "2025-12-31", periodType: "FY", currency: "IDR", documentScale: "1" }, expected: { ocr: [4, 5, 6, 7], eventPage: 71, paymentEvidencePage: 11, eventType: "FINAL", total: "202352938000", totalCurrency: "IDR", perShare: "43", perShareCurrency: "IDR", approval: "2025-04-22", payment: null, segmentPage: 91, segments: 4, revenue: 4, operatingProfit: 0 } },
];

for (const item of cases) {
  const path = process.env[item.env];
  test(`${item.ticker} dividend event, segment facts, lineage, temporal identity and idempotency`, { skip: !path }, async () => {
    const bytes = await readFile(path!);
    const first = await runPhase6B({ bytes, context: item.context });
    const second = await runPhase6B({ bytes, context: item.context });
    assert.deepEqual(second, first, "identical source and context must produce an immutable logical identity");
    assert.equal(first.dividendEvents.length, 1);
    assert.equal(first.segmentIdentities.length, item.expected.segments);
    assert.equal(first.segmentFacts.filter((fact) => fact.metricCode === "REVENUE").length, item.expected.revenue);
    assert.equal(first.segmentFacts.filter((fact) => fact.metricCode === "OPERATING_PROFIT").length, item.expected.operatingProfit);
    assert.deepEqual(first.p0a.ocrPages, item.expected.ocr);
    assert.equal(first.providerUsage.providerCalls, 0);
    assert.equal(first.providerUsage.costUsd, "0.00000000");

    const event = first.dividendEvents[0];
    assert.equal(event.eventType, item.expected.eventType);
    assert.equal(event.status, "PAID");
    assert.equal(event.total?.normalizedValue, item.expected.total);
    assert.equal(event.total?.currency, item.expected.totalCurrency);
    assert.equal(event.perShare?.normalizedValue, item.expected.perShare);
    assert.equal(event.perShare?.currency, item.expected.perShareCurrency);
    assert.equal(event.dates.approval, item.expected.approval);
    assert.equal(event.dates.payment, item.expected.payment);
    assert.equal(event.sourceProfitPeriod.end, "2024-12-31");
    assert.ok(event.evidence.some((link) => link.evidence.pageNumber === item.expected.eventPage));
    if (item.expected.paymentEvidencePage) assert.ok(event.evidence.some((link) => link.evidence.pageNumber === item.expected.paymentEvidencePage));
    assert.ok(event.evidence.every((link) => link.evidence.evidenceHash && link.evidence.locatorHash && link.evidence.snippetHash));
    assert.equal(event.fieldStates.cum, "FIELD_NOT_DISCLOSED");
    assert.equal(event.fieldStates.ex, "FIELD_NOT_DISCLOSED");

    assert.ok(first.segmentIdentities.every((identity) => identity.identityKey && identity.validFrom === item.context.periodStart && identity.validTo === item.context.periodEnd && identity.evidence.length));
    assert.ok(first.segmentFacts.every((fact) => fact.factKey && fact.dimensionHash && fact.sourceDocumentSha256 === first.documentSha256 && fact.metricLabel && fact.sourceMetricLabel && fact.periodColumn.includes("2025") && fact.period.end === item.context.periodEnd && fact.evidence[0]?.pageNumber === item.expected.segmentPage));
    assert.equal(new Set(first.segmentIdentities.map((identity) => identity.identityKey)).size, item.expected.segments);
    assert.equal(new Set(first.segmentFacts.map((fact) => fact.factKey)).size, first.segmentFacts.length);

    const revenueControl = first.reconciliations.find((control) => control.controlId === "SEGMENT_REVENUE_EXTERNAL_RECONCILIATION");
    assert.deepEqual({ applicable: revenueControl?.applicable, passed: revenueControl?.passed, difference: revenueControl?.difference }, { applicable: true, passed: true, difference: "0" });
    const operatingOutcome = first.outcomes.find((outcome) => outcome.requirementId === "SEGMENT_OPERATING_PROFIT");
    assert.equal(operatingOutcome?.state, item.expected.operatingProfit ? "VALUE" : "NOT_DISCLOSED");
    if (!item.expected.operatingProfit) assert.match(operatingOutcome?.reason ?? "", /not relabeled/i);
  });
}
