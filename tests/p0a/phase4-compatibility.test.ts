import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { GET as getExtractionQa } from "../../app/api/diagnostics/extraction-qa/route";
import { compareLegacyFact } from "../../lib/financial/p0a/compatibility-read";
import {
  createRoutingSnapshot,
  routingSnapshotsEqual,
  RoutingSnapshotIdentityConflictError,
} from "../../lib/financial/p0a/routing-snapshot";
import type { P0ARoutedPage } from "../../lib/financial/p0a/types";

function routedPage(pageClass: P0ARoutedPage["pageClass"]): P0ARoutedPage {
  return {
    pageNumber: 1,
    width: 600,
    height: 800,
    text: "Statement",
    normalizedText: "statement",
    textHash: "a".repeat(64),
    layoutHash: "b".repeat(64),
    printedPageLabel: "1",
    tokens: [],
    extractionStatus: "NATIVE_TEXT",
    pageClass,
    statementType: pageClass === "PRIMARY_BALANCE_SHEET" ? "BALANCE_SHEET" : "OTHER",
    confidence: 0.99,
    matchedAnchors: ["statement of financial position"],
  };
}

test("routing snapshots retain only approved minimal fields and compare canonically", () => {
  const snapshot = createRoutingSnapshot([routedPage("PRIMARY_BALANCE_SHEET")]);
  assert.deepEqual(Object.keys(snapshot[0]).sort(), [
    "confidence",
    "layoutHash",
    "matchedAnchors",
    "pageClass",
    "pageNumber",
    "statementType",
    "textHash",
  ]);
  const reordered = [{
    layoutHash: snapshot[0].layoutHash,
    textHash: snapshot[0].textHash,
    matchedAnchors: snapshot[0].matchedAnchors,
    confidence: snapshot[0].confidence,
    statementType: snapshot[0].statementType,
    pageClass: snapshot[0].pageClass,
    pageNumber: snapshot[0].pageNumber,
  }];
  assert.equal(routingSnapshotsEqual(snapshot, reordered), true);
  assert.equal(routingSnapshotsEqual(snapshot, createRoutingSnapshot([routedPage("OTHER")])), false);
  assert.match(new RoutingSnapshotIdentityConflictError().message, /ROUTING_SNAPSHOT_IDENTITY_CONFLICT/);
});

function comparisonInput() {
  return {
    newState: "VALUE",
    newValue: "100",
    newCurrency: "IDR",
    newScale: "1000000",
    unitType: "DOCUMENT_CURRENCY",
    periodNature: "DURATION" as const,
    code: "REV",
    companyId: "company-1",
    periodStart: new Date("2025-01-01"),
    periodEnd: new Date("2025-06-30"),
    periodType: "H1",
    consolidated: true,
    legacyReport: {
      companyId: "company-1",
      periodStart: new Date("2025-01-01"),
      periodEnd: new Date("2025-06-30"),
      periodType: "H1",
      consolidated: true,
    },
    legacyEntry: {
      value: new Prisma.Decimal("100"),
      originalValue: null,
      scale: 1000000,
      currency: "IDR",
      canonicalAccount: { code: "REV", valueNature: "FLOW" },
    },
  };
}

test("legacy comparison emits MATCH and DIFFERENT only with full safe comparability", () => {
  assert.equal(compareLegacyFact(comparisonInput()).state, "MATCH");
  assert.equal(compareLegacyFact({
    ...comparisonInput(),
    legacyEntry: { ...comparisonInput().legacyEntry, value: new Prisma.Decimal("101") },
  }).state, "DIFFERENT");
  assert.equal(compareLegacyFact({ ...comparisonInput(), consolidated: false }).state, "NOT_COMPARABLE");
  assert.equal(compareLegacyFact({ ...comparisonInput(), newScale: "1" }).state, "NOT_COMPARABLE");
  assert.equal(compareLegacyFact({
    ...comparisonInput(),
    legacyEntry: { ...comparisonInput().legacyEntry, currency: "USD" },
  }).state, "NOT_COMPARABLE");
  assert.equal(compareLegacyFact({ ...comparisonInput(), legacyEntry: null }).state, "NO_LEGACY_VALUE");
  assert.equal(compareLegacyFact({ ...comparisonInput(), newState: "NOT_DISCLOSED", newValue: null }).state, "NOT_COMPARABLE");
});

test("Phase 4 migration is history-preserving and uses truthful legacy sentinels", async () => {
  const sql = await readFile(
    "prisma/migrations/20260912220000_phase4_identity_routing_snapshot/migration.sql",
    "utf8",
  );
  assert.match(sql, /ADD COLUMN "routingSnapshot" JSONB/);
  assert.match(sql, /SET "mappingVersion" = 'legacy-unversioned'[\s\S]*WHERE "mappingVersion" IS NULL/);
  assert.match(sql, /SET "scopedPromptVersion" = 'legacy-unversioned'[\s\S]*WHERE "scopedPromptVersion" IS NULL/);
  assert.match(sql, /ALTER COLUMN "mappingVersion" SET NOT NULL/);
  assert.match(sql, /P0AExtractionPass_complete_identity_key/);
  for (const field of [
    "contractVersion",
    "parserVersion",
    "routerVersion",
    "applicabilityVersion",
    "plannerVersion",
    "gapVersion",
    "validationVersion",
    "mappingVersion",
    "scopedPromptVersion",
    "contextHash",
    "shadowMode",
  ]) assert.match(sql, new RegExp('"' + field + '"'));
  assert.match(sql, /CREATE INDEX "P0AReportRevision_contextHash_idx"/);
  assert.doesNotMatch(sql, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
  assert.doesNotMatch(sql, /SET "(?:mappingVersion|scopedPromptVersion)" = 'p0a-/);
});

test("Extraction QA API is read-only and default OFF", async () => {
  const previous = process.env.INVESTAI_EXTRACTION_QA;
  delete process.env.INVESTAI_EXTRACTION_QA;
  try {
    const response = await getExtractionQa(new Request("http://localhost/api/diagnostics/extraction-qa"));
    assert.equal(response.status, 404);
  } finally {
    if (previous === undefined) delete process.env.INVESTAI_EXTRACTION_QA;
    else process.env.INVESTAI_EXTRACTION_QA = previous;
  }
  const source = await readFile("app/api/diagnostics/extraction-qa/route.ts", "utf8");
  assert.match(source, /export async function GET/);
  assert.doesNotMatch(source, /export async function (?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /OPENAI_API_KEY|DATABASE_URL|process\.env(?!\.INVESTAI_EXTRACTION_QA)/);
});

test("Phase 4 persistence has no legacy canonical write path", async () => {
  const source = await readFile("lib/financial/p0a/persistence.ts", "utf8");
  assert.doesNotMatch(source, /\.(?:financialEntry|financialReport)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
});
