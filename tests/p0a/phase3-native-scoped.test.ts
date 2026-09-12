import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseFinancialDecimal } from "../../lib/financial/p0a/decimal";
import { detectP0AGaps } from "../../lib/financial/p0a/gap-detector";
import { evaluateIcbpNativeAcceptance } from "../../lib/financial/p0a/native-acceptance";
import { createNativeFinancialExtractor } from "../../lib/financial/p0a/native-extractor";
import { runP0ANativePipeline } from "../../lib/financial/p0a/pipeline";
import {
  buildScopedOpenAIRequest,
  InMemoryScopedProviderCache,
  PHASE3_PROVIDER_SUBMISSION_LIMIT,
  scopedProviderCacheKey,
  ScopedOpenAIExtractor,
  ScopedSubmissionUnknownError,
  type ScopedExtractionInput,
  type ScopedProviderTransport,
} from "../../lib/financial/p0a/scoped-openai-extractor";
import type { P0AIssuerContext, P0AObservation, P0APageToken, P0ARoutedPage } from "../../lib/financial/p0a/types";

const context: P0AIssuerContext = {
  ticker: "TEST", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL",
  consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30",
  periodType: "H1", currency: "IDR", documentScale: "1000000",
};

function token(text: string, x: number, y: number): P0APageToken { return { text, x, y, width: Math.max(5, text.length * 4), height: 8, lineBreak: false }; }
function syntheticIncomePage(rawCurrent = "1.234.567", label = "PENJUALAN NETO", english = "NET SALES"): P0ARoutedPage {
  const tokens = [
    token("INTERIM CONSOLIDATED STATEMENT OF PROFIT OR LOSS", 50, 760),
    token("2025", 275, 700), token("2024", 365, 700),
    token(label, 50, 650), token(rawCurrent, 280, 650), token("999.999", 370, 650), token(english, 450, 650),
  ];
  const text = `INTERIM CONSOLIDATED STATEMENT OF PROFIT OR LOSS\n2025 2024\n${label} ${rawCurrent} 999.999 ${english}`;
  return {
    pageNumber: 1, width: 600, height: 800, text, normalizedText: text.toLowerCase(),
    textHash: "a".repeat(64), layoutHash: "b".repeat(64), printedPageLabel: "1", tokens, extractionStatus: "NATIVE_TEXT",
    pageClass: "PRIMARY_INCOME_STATEMENT", statementType: "INCOME_STATEMENT", confidence: 1, matchedAnchors: ["statement of profit or loss"],
  };
}

async function extractOne(page: P0ARoutedPage, requirementId: string) {
  const extractor = createNativeFinancialExtractor({ routedPages: [page], context });
  return extractor({ stage: "PRIMARY", route: "PRIMARY", selectedPages: [1], requirementIds: [requirementId], cacheKey: "test" }, [page]);
}

test("generic native row extraction selects current period and accepts bilingual label", async () => {
  const facts = await extractOne(syntheticIncomePage(), "REV_REPORTED");
  assert.equal(facts.length, 1);
  assert.equal(facts[0].decimalValue, "1234567");
  assert.equal(facts[0].rawLabel.includes("NET SALES"), true);
  assert.equal(facts[0].period.end, "2025-06-30");
  assert.equal(facts[0].evidence[0].pageNumber, 1);
  assert.equal(facts[0].evidence[0].rowIndex !== undefined, true);
  assert.equal(facts[0].evidence[0].locatorHash.length, 64);
});

test("native parser preserves parentheses sign, document scale, and Decimal precision", async () => {
  assert.equal(parseFinancialDecimal("(9.007.199.254.740.993)")?.decimal, "-9007199254740993");
  const page = syntheticIncomePage("(1.294.976)", "Beban keuangan", "Finance expenses");
  const facts = await extractOne(page, "FINANCE_COST_REPORTED");
  assert.equal(facts[0].decimalValue, "-1294976");
  assert.equal(facts[0].scale, "1000000");
  assert.equal(facts[0].unitType, "DOCUMENT_CURRENCY");
});

test("explicit ambiguity is preserved instead of guessed", () => {
  const ambiguous: P0AObservation = {
    requirementId: "REV_REPORTED", origin: "REPORTED", state: "AMBIGUOUS", decimalValue: null,
    rawValue: "1.000 | 1.100", currency: "IDR", unitType: "DOCUMENT_CURRENCY", scale: "1000000", evidence: [],
  };
  const requirement = { id: "REV_REPORTED", legacyCode: "REV", definition: "Revenue", statementType: "INCOME_STATEMENT", expectation: "EXPECTED", unitType: "DOCUMENT_CURRENCY", periodNature: "DURATION", routes: ["PRIMARY"], targetedAnchors: [] } as const;
  const outcome = detectP0AGaps([{ requirement, expectation: "EXPECTED", ruleVersion: "test", rationale: "test" }], [ambiguous], new Map([["REV_REPORTED", ["PRIMARY"]]]), new Map([["REV_REPORTED", [1]]]), true)[0];
  assert.equal(outcome.state, "AMBIGUOUS");
});

test("calculated alternative never increases reported coverage", () => {
  const aggregate: P0AObservation = {
    requirementId: "AR_REPORTED", origin: "STANDARDIZED_AGGREGATE", state: "VALUE", decimalValue: "30",
    rawValue: "10 + 20", currency: "IDR", unitType: "DOCUMENT_CURRENCY", scale: "1", evidence: [], sourceFactIds: ["a", "b"],
  };
  const requirement = { id: "AR_REPORTED", legacyCode: "AR", definition: "AR", statementType: "BALANCE_SHEET", expectation: "OPTIONAL", unitType: "DOCUMENT_CURRENCY", periodNature: "INSTANT", routes: ["PRIMARY", "NOTE"], targetedAnchors: [] } as const;
  const outcome = detectP0AGaps([{ requirement, expectation: "OPTIONAL", ruleVersion: "test", rationale: "test" }], [aggregate], new Map([["AR_REPORTED", ["PRIMARY"]]]), new Map([["AR_REPORTED", [1]]]), true)[0];
  assert.equal(outcome.state, "NOT_DISCLOSED");
  assert.equal(outcome.reportedObservation, null);
  assert.equal(outcome.calculatedAlternative?.decimalValue, "30");
});

function scopedInput(suffix = "a"): ScopedExtractionInput {
  const page = syntheticIncomePage();
  return {
    document: { sha256: suffix.repeat(64).slice(0, 64), pageCount: 109, fileName: "pilot.pdf" }, context,
    unresolvedRequirementIds: ["AR_REPORTED"], inputMode: "PAGE_MARKED_TEXT",
    pages: [{ pageNumber: 4, printedPageLabel: "1", width: page.width, height: page.height, text: "Trade receivable components only", textHash: suffix.repeat(64).slice(0, 64), layoutHash: "b".repeat(64), tokens: [] }],
  };
}

function successTransport(counter: { calls: number }): ScopedProviderTransport {
  return { async submit() {
    counter.calls += 1;
    return {
      providerRequestId: `req-${counter.calls}`, providerResponseId: `resp-${counter.calls}`,
      inputTokens: 100, outputTokens: 50, billedCostUsd: null,
      outputText: JSON.stringify({ facts: [{
        requirementId: "AR_REPORTED", state: "NOT_DISCLOSED", rawLabel: null, rawValue: null, decimalValue: null,
        currency: null, unit: null, scale: null, periodEnd: null, consolidationScope: "CONSOLIDATED",
        pageNumber: 4, sourceSnippet: "Trade receivable components only", rationale: "No directly reported scalar.",
      }] }),
    };
  } };
}

test("provider contract includes only unresolved IDs and selected page text with no full-PDF fallback", () => {
  const body = buildScopedOpenAIRequest(scopedInput(), "gpt-test");
  const serialized = JSON.stringify(body);
  assert.match(serialized, /AR_REPORTED/);
  assert.match(serialized, /ORIGINAL PDF PAGE 4/);
  assert.doesNotMatch(serialized, /%PDF-/);
  assert.doesNotMatch(serialized, /inspect the entire pdf/i);
  assert.doesNotMatch(serialized, /ORIGINAL PDF PAGE 5/);
});

test("provider cache identity covers pages, requirements, versions, provider, and model", () => {
  const input = scopedInput();
  const base = scopedProviderCacheKey(input, "openai", "model-a");
  assert.notEqual(base, scopedProviderCacheKey({ ...input, pages: [{ ...input.pages[0], pageNumber: 5 }] }, "openai", "model-a"));
  assert.notEqual(base, scopedProviderCacheKey({ ...input, unresolvedRequirementIds: ["AP_REPORTED"] }, "openai", "model-a"));
  assert.notEqual(base, scopedProviderCacheKey(input, "openai", "model-b"));
});

test("approval and isolated-database guards prevent provider and canonical execution", async () => {
  const counter = { calls: 0 };
  const extractor = new ScopedOpenAIExtractor("gpt-test", successTransport(counter), new InMemoryScopedProviderCache());
  await assert.rejects(extractor.execute(scopedInput(), { explicitlyApproved: false, shadowDatabaseName: "investai_phase3_test", canonicalWriteEnabled: false }), /APPROVAL_REQUIRED/);
  await assert.rejects(extractor.execute(scopedInput(), { explicitlyApproved: true, shadowDatabaseName: "production", canonicalWriteEnabled: true } as never), /canonical writes|isolated/i);
  assert.equal(counter.calls, 0);
});

test("validated cache prevents duplicate provider charge", async () => {
  const counter = { calls: 0 };
  const extractor = new ScopedOpenAIExtractor("gpt-test", successTransport(counter), new InMemoryScopedProviderCache());
  const guard = { explicitlyApproved: true, shadowDatabaseName: "investai_phase3_test", canonicalWriteEnabled: false } as const;
  const first = await extractor.execute(scopedInput(), guard);
  const second = await extractor.execute(scopedInput(), guard);
  assert.equal(counter.calls, 1);
  assert.equal(first.usage.providerCalls, 1);
  assert.equal(second.usage.providerCalls, 0);
  assert.equal(second.usage.status, "CACHE_HIT");
});

test("hard pilot ceiling blocks a third provider submission", async () => {
  const counter = { calls: 0 };
  const extractor = new ScopedOpenAIExtractor("gpt-test", successTransport(counter), new InMemoryScopedProviderCache());
  const guard = { explicitlyApproved: true, shadowDatabaseName: "investai_phase3_test", canonicalWriteEnabled: false } as const;
  await extractor.execute(scopedInput("a"), guard);
  await extractor.execute(scopedInput("b"), guard);
  await assert.rejects(extractor.execute(scopedInput("c"), guard), /CALL_CEILING/);
  assert.equal(counter.calls, PHASE3_PROVIDER_SUBMISSION_LIMIT);
});

test("submission-unknown is surfaced without automatic retry", async () => {
  const counter = { calls: 0 };
  const transport: ScopedProviderTransport = { async submit() { counter.calls += 1; throw new Error("socket closed after submit"); } };
  const extractor = new ScopedOpenAIExtractor("gpt-test", transport, new InMemoryScopedProviderCache());
  await assert.rejects(
    extractor.execute(scopedInput(), { explicitlyApproved: true, shadowDatabaseName: "investai_phase3_test", canonicalWriteEnabled: false }),
    (error) => error instanceof ScopedSubmissionUnknownError && error.usage?.status === "SUBMISSION_UNKNOWN" && error.usage.providerCalls === 1,
  );
  assert.equal(counter.calls, 1);
});

test("Phase 3 migration is shadow-only and does not alter canonical tables", async () => {
  const sql = await readFile("prisma/migrations/20260912200000_phase3_native_scoped_metadata/migration.sql", "utf8");
  assert.match(sql, /P0AExtractionPass/);
  assert.match(sql, /P0AFactEvidence/);
  assert.match(sql, /P0AFactAssertion/);
  assert.doesNotMatch(sql, /(?:ALTER|UPDATE|DELETE FROM|TRUNCATE)\s+(?:TABLE\s+)?"(?:FinancialEntry|FinancialReport|CanonicalAccount|ExtractionRun)"/i);
});

const icbpPath = process.env.P0A_ICBP_PDF_PATH;
test("ICBP Phase 3A native acceptance", { skip: !icbpPath }, async () => {
  const bytes = await readFile(icbpPath!);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089");
  const result = await runP0ANativePipeline({ bytes, context: { ...context, ticker: "ICBP" } });
  const metrics = evaluateIcbpNativeAcceptance({ observations: result.observations as never, outcomes: result.outcomes, routedPages: result.routedPages, selectedPages: result.selectedPages, latencyMs: result.usage.processingLatencyMs });
  assert.deepEqual(result.selectedPages, [4, 5, 6, 7, 8, 9, 10, 86, 88]);
  assert.equal(metrics.reportedGoldCoveragePct, 100);
  assert.equal(metrics.digitAndSignAccuracyPct, 100);
  assert.equal(metrics.unitAndScaleAccuracyPct, 100);
  assert.equal(metrics.periodAccuracyPct, 100);
  assert.equal(metrics.evidenceCompletenessPct, 100);
  assert.equal(metrics.calculatedAlternativeAccuracyPct, 100);
  assert.deepEqual(metrics.incorrectFacts, []);
  assert.equal(metrics.providerCalls, 0);
  assert.equal(metrics.productionCanonicalWrites, 0);
});
