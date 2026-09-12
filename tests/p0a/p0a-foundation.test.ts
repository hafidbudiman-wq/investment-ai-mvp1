import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveP0AApplicability } from "../../lib/financial/p0a/applicability";
import { planPrimaryTask } from "../../lib/financial/p0a/fact-planner";
import { detectP0AGaps } from "../../lib/financial/p0a/gap-detector";
import { zeroAiShadowUsage } from "../../lib/financial/p0a/metering";
import { P0A_EXCLUDED_LATER_PHASE_CODES, P0A_REQUIREMENTS } from "../../lib/financial/p0a/requirements";
import type { P0AIndexedPage, P0AObservation, P0ARoutedPage } from "../../lib/financial/p0a/types";
import { canTransitionJob } from "../../lib/platform/jobs/job-types";

const context = {
  ticker: "TEST", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL",
  consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30",
  periodType: "H1", currency: "IDR", documentScale: "1000000",
} as const;

function page(pageNumber: number, pageClass: P0ARoutedPage["pageClass"]): P0ARoutedPage {
  const base: P0AIndexedPage = {
    pageNumber, width: 1, height: 1, text: "statement", normalizedText: "statement",
    textHash: `${pageNumber}`, layoutHash: `${pageNumber}`, printedPageLabel: null,
    tokens: [], extractionStatus: "NATIVE_TEXT",
  };
  return { ...base, pageClass, statementType: "INCOME_STATEMENT", confidence: 1, matchedAnchors: [] };
}

test("frozen P0-A registry has 34 requirements and excludes later-phase metrics", () => {
  assert.equal(P0A_REQUIREMENTS.length, 34);
  for (const code of ["TOTAL_DEBT", "CAPEX", "FCF", "EBITDA"]) assert.ok(P0A_EXCLUDED_LATER_PHASE_CODES.includes(code));
});

test("financial accounting models fail closed in P0-A", () => {
  const decisions = resolveP0AApplicability({ ...context, accountingModel: "BANK" });
  assert.ok(decisions.every((decision) => decision.expectation === "NOT_APPLICABLE"));
});

test("planner has no universal ten-page extraction ceiling", () => {
  const pages = Array.from({ length: 12 }, (_, index) => page(index + 1, "PRIMARY_INCOME_STATEMENT"));
  const task = planPrimaryTask("document-context", pages, resolveP0AApplicability(context));
  assert.equal(task.selectedPages.length, 12);
});

test("reported absence remains a gap even when a calculated aggregate exists", () => {
  const decisions = resolveP0AApplicability(context).filter((item) => item.requirement.legacyCode === "AR");
  const aggregate: P0AObservation = {
    requirementId: "AR_REPORTED", origin: "STANDARDIZED_AGGREGATE", state: "VALUE",
    decimalValue: "10", rawValue: "4 + 6", currency: "IDR", unitType: "DOCUMENT_CURRENCY", scale: "1", evidence: [],
  };
  const result = detectP0AGaps(decisions, [aggregate], new Map([["AR_REPORTED", ["PRIMARY", "NOTE"]]]), new Map([["AR_REPORTED", [1, 2]]]), true)[0];
  assert.equal(result.state, "NOT_DISCLOSED");
  assert.equal(result.reportedObservation, null);
  assert.equal(result.calculatedAlternative?.origin, "STANDARDIZED_AGGREGATE");
});

test("shadow usage is explicit zero-provider metadata", () => {
  const usage = zeroAiShadowUsage(9, 34, 123);
  assert.equal(usage.providerCalls, 0);
  assert.equal(usage.provider, null);
  assert.equal(usage.model, null);
  assert.equal(usage.selectedPageCount, 9);
  assert.equal(usage.requirementCount, 34);
});

test("submission-unknown is durable and not automatically reclaimable", () => {
  assert.equal(canTransitionJob("RUNNING", "SUBMISSION_UNKNOWN"), true);
  assert.equal(canTransitionJob("SUBMISSION_UNKNOWN", "QUEUED"), true);
  assert.equal(canTransitionJob("SUBMISSION_UNKNOWN", "SUCCEEDED"), false);
});

test("P0-A migration is additive and uses no competing calculation schema", async () => {
  const sql = await readFile("prisma/migrations/20260912120000_p0a_ingestion_foundation/migration.sql", "utf8");
  assert.doesNotMatch(sql, /Calculation(Result|Input)/);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM|TRUNCATE|ALTER TABLE)\s+"(?:FinancialEntry|FinancialReport|ExtractionRun|CanonicalAccount)"/i);
  for (const column of ["providerRequestId", "providerResponseId", "selectedPageCount", "requirementCount", "documentPageCount", "validatedFactCount", "executionMode", "inputTokens", "outputTokens", "processingLatencyMs", "estimatedCostUsd", "billedCostUsd", "providerCalls"]) {
    assert.match(sql, new RegExp(`"${column}"`));
  }
});
