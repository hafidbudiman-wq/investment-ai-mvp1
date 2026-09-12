import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import {
  readExtractionQa,
  type ExtractionQaEvidence,
  type ExtractionQaFact,
  type ExtractionQaReadModel,
} from "../lib/financial/p0a/compatibility-read";
import { evaluateIcbpNativeAcceptance } from "../lib/financial/p0a/native-acceptance";
import { runP0ANativePipeline, type P0APipelineResult } from "../lib/financial/p0a/pipeline";
import { loadCachedP0APageIndex, persistP0AShadowResult } from "../lib/financial/p0a/persistence";
import { createRoutingSnapshot } from "../lib/financial/p0a/routing-snapshot";
import type { P0ANativeObservation } from "../lib/financial/p0a/types";
import { P0A_PARSER_VERSION } from "../lib/financial/p0a/versions";
import { prisma } from "../lib/prisma";

const EXPECTED_SHA = "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089";
const EXPECTED_SELECTED_PAGES = [4, 5, 6, 7, 8, 9, 10, 86, 88];
const pdfPath = process.env.P0A_ICBP_PDF_PATH ?? "";
const databaseUrl = process.env.DATABASE_URL ?? "";

if (!pdfPath) throw new Error("P0A_ICBP_PDF_PATH is required.");
let databaseName = "";
try { databaseName = new URL(databaseUrl).pathname.slice(1); } catch { /* rejected below */ }
if (!/p0a_shadow/i.test(databaseName)) {
  throw new Error("Refusing Phase 4 acceptance outside an isolated database whose name contains p0a_shadow.");
}

const context = {
  ticker: "ICBP",
  issuerType: "LISTED_COMMON_EQUITY",
  accountingModel: "NON_FINANCIAL",
  consolidated: true,
  audited: false,
  periodStart: "2025-01-01",
  periodEnd: "2025-06-30",
  periodType: "H1",
  currency: "IDR",
  documentScale: "1000000",
} as const;

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function p0aCounts(documentId: string, passId: string) {
  const revision = await prisma.p0AReportRevision.findUniqueOrThrow({ where: { passId } });
  return {
    pages: await prisma.p0ADocumentPage.count({ where: { documentId } }),
    passes: await prisma.p0AExtractionPass.count({ where: { documentId } }),
    tasks: await prisma.p0AExtractionTask.count({ where: { passId } }),
    outcomes: await prisma.p0ARequirementOutcome.count({ where: { passId } }),
    revisions: await prisma.p0AReportRevision.count({ where: { documentId } }),
    assertions: await prisma.p0AFactAssertion.count({ where: { reportRevisionId: revision.id } }),
    evidence: await prisma.p0AFactEvidence.count({ where: { documentId } }),
    assertionEvidence: await prisma.p0AFactAssertionEvidence.count({
      where: { assertion: { reportRevisionId: revision.id } },
    }),
  };
}

async function legacySnapshot() {
  const [reports, statements, accounts, entries, runs, chunks, candidates] = await Promise.all([
    prisma.financialReport.findMany({ orderBy: { id: "asc" } }),
    prisma.financialStatement.findMany({ orderBy: { id: "asc" } }),
    prisma.canonicalAccount.findMany({ orderBy: { id: "asc" } }),
    prisma.financialEntry.findMany({ orderBy: { id: "asc" } }),
    prisma.extractionRun.findMany({ orderBy: { id: "asc" } }),
    prisma.extractionChunk.findMany({ orderBy: { id: "asc" } }),
    prisma.extractionCandidate.findMany({ orderBy: { id: "asc" } }),
  ]);
  return {
    counts: {
      reports: reports.length,
      statements: statements.length,
      accounts: accounts.length,
      entries: entries.length,
      runs: runs.length,
      chunks: chunks.length,
      candidates: candidates.length,
    },
    fingerprint: hash(JSON.stringify({ reports, statements, accounts, entries, runs, chunks, candidates })),
  };
}

async function seedLegacySentinel(companyId: string) {
  const report = await prisma.financialReport.create({
    data: {
      companyId,
      year: 2024,
      periodType: "FY",
      periodStart: new Date("2024-01-01T00:00:00.000Z"),
      periodEnd: new Date("2024-12-31T00:00:00.000Z"),
      audited: true,
      consolidated: true,
      sourceType: "MANUAL",
      status: "VERIFIED",
    },
  });
  const statement = await prisma.financialStatement.create({
    data: { reportId: report.id, statementType: "OTHER", currency: "IDR" },
  });
  const account = await prisma.canonicalAccount.create({
    data: { code: "P0A_PHASE4_LEGACY_SENTINEL", name: "Phase 4 legacy mutation sentinel", statementType: "OTHER" },
  });
  await prisma.financialEntry.create({
    data: {
      reportId: report.id,
      statementId: statement.id,
      canonicalAccountId: account.id,
      value: new Prisma.Decimal("123"),
      originalValue: new Prisma.Decimal("123"),
      scale: 1,
      currency: "IDR",
      rawText: "must remain unchanged",
      reviewStatus: "VERIFIED",
    },
  });
  await prisma.extractionRun.create({
    data: {
      companyId,
      fileName: "legacy-phase4-sentinel.pdf",
      fileSize: 1,
      checksum: "a".repeat(64),
      status: "UPLOADED",
    },
  });
}

function semanticPipelineProjection(result: P0APipelineResult) {
  return {
    documentSha256: result.documentSha256,
    contextHash: result.contextHash,
    versions: result.versions,
    routingSnapshot: createRoutingSnapshot(result.routedPages),
    tasks: result.tasks,
    selectedPages: result.selectedPages,
    observations: result.observations,
    outcomes: result.outcomes,
    validations: result.validations,
    providerCalls: result.usage.providerCalls,
    shadowMode: result.shadowMode,
  };
}

function stableQaProjection(read: ExtractionQaReadModel) {
  return {
    summary: { ...read.summary, nativeLatencyMs: 0 },
    versions: read.versions,
    facts: read.facts,
  };
}

function assertExactCompatibilityRoundTrip(
  result: P0APipelineResult,
  read: ExtractionQaReadModel,
  documentId: string,
) {
  assert.equal(read.facts.length, result.outcomes.length);
  const facts = new Map(read.facts.map((fact) => [fact.requirementId, fact]));
  const reportedObservations = new Map(
    result.observations
      .filter((observation) => observation.origin === "REPORTED")
      .map((observation) => [observation.requirementId, observation as P0ANativeObservation]),
  );
  for (const outcome of result.outcomes) {
    const fact = facts.get(outcome.requirementId);
    assert.ok(fact, `Missing compatibility fact ${outcome.requirementId}`);
    assert.equal(fact.state, outcome.state, `${outcome.requirementId} state`);
    const observation = reportedObservations.get(outcome.requirementId) ?? null;
    if (!observation) {
      assert.equal(fact.value, null, `${outcome.requirementId} must not fabricate a value`);
      assert.equal(fact.origin, null, `${outcome.requirementId} must not fabricate an origin`);
      continue;
    }
    assert.equal(fact.value, observation.decimalValue, `${outcome.requirementId} value/sign`);
    assert.equal(fact.rawValue, observation.rawValue, `${outcome.requirementId} raw value`);
    assert.equal(fact.currency, observation.currency, `${outcome.requirementId} currency`);
    assert.equal(fact.unitType, observation.unitType, `${outcome.requirementId} unit`);
    assert.equal(fact.scale, observation.scale, `${outcome.requirementId} scale`);
    assert.equal(fact.origin, "REPORTED", `${outcome.requirementId} origin`);
    assert.deepEqual(fact.period, {
      start: observation.period.start,
      end: observation.period.end,
      type: observation.period.type,
      consolidationScope: observation.consolidationScope === "STANDALONE" ? "SEPARATE" : observation.consolidationScope,
    }, `${outcome.requirementId} period/scope`);
    assert.ok(fact.lineage.assertionId, `${outcome.requirementId} assertion lineage`);
    assert.ok(fact.lineage.assertionKey, `${outcome.requirementId} assertion key`);
    assert.equal(fact.lineage.definitionVersion, result.versions.contract, `${outcome.requirementId} definition lineage`);
    assert.equal(fact.evidence.length, observation.evidence.length, `${outcome.requirementId} evidence count`);
    for (const [index, expected] of observation.evidence.entries()) {
      const actual: ExtractionQaEvidence = fact.evidence[index];
      assert.deepEqual({
        pdfPage: actual.pdfPage,
        printedPage: actual.printedPage,
        rowLabel: actual.rowLabel,
        columnLabel: actual.columnLabel,
        rawValue: actual.rawValue,
        snippet: actual.snippet,
        snippetHash: actual.snippetHash,
        locatorHash: actual.locatorHash,
      }, {
        pdfPage: expected.pageNumber,
        printedPage: expected.printedPageLabel,
        rowLabel: expected.rowLabel,
        columnLabel: expected.columnLabel,
        rawValue: expected.rawValue,
        snippet: expected.snippet,
        snippetHash: expected.snippetHash,
        locatorHash: expected.locatorHash,
      }, `${outcome.requirementId} evidence ${index}`);
      assert.equal(
        actual.evidenceHash,
        hash([documentId, expected.locatorHash, expected.snippetHash].join("|")),
        `${outcome.requirementId} persisted evidence hash`,
      );
    }
  }
}

async function main() {
  assert.equal(await prisma.p0AExtractionPass.count(), 0, "Acceptance database must be a fresh isolated P0-A database.");
  assert.equal(await prisma.company.count(), 0, "Acceptance database must be empty before seeding the ICBP fixture.");

  const bytes = await readFile(pdfPath);
  const actualSha = hash(bytes);
  assert.equal(actualSha, EXPECTED_SHA, "ICBP PDF SHA-256");

  const company = await prisma.company.create({
    data: { ticker: "ICBP", name: "PT Indofood CBP Sukses Makmur Tbk", currency: "IDR" },
  });
  await seedLegacySentinel(company.id);
  const document = await prisma.financialDocument.create({
    data: {
      storageProvider: "isolated-shadow",
      bucket: "p0a-shadow",
      objectKey: `phase4/icbp/${EXPECTED_SHA}.pdf`,
      originalFileName: "ICBP_billingual_30Jun25.pdf",
      mimeType: "application/pdf",
      verifiedSize: bytes.length,
      sha256: actualSha,
      content: bytes,
      magicBytesVerified: true,
      status: "VERIFIED",
      verifiedAt: new Date(),
    },
  });
  const legacyBefore = await legacySnapshot();

  const firstResult = await runP0ANativePipeline({ bytes, context });
  const nativeMetrics = evaluateIcbpNativeAcceptance({
    observations: firstResult.observations as P0ANativeObservation[],
    outcomes: firstResult.outcomes,
    routedPages: firstResult.routedPages,
    selectedPages: firstResult.selectedPages,
    latencyMs: firstResult.usage.processingLatencyMs,
  });
  const firstPersisted = await persistP0AShadowResult(prisma, {
    documentId: document.id,
    companyId: company.id,
    context,
    result: firstResult,
  });
  const firstRead = await readExtractionQa(prisma, { passId: firstPersisted.passId });
  assert.ok(firstRead);
  assertExactCompatibilityRoundTrip(firstResult, firstRead, document.id);
  const firstCounts = await p0aCounts(document.id, firstPersisted.passId);

  const cachedPages = await loadCachedP0APageIndex(prisma, document.id, P0A_PARSER_VERSION);
  assert.ok(cachedPages && cachedPages.length === 109, "Second run must use the complete cached page index.");
  const secondResult = await runP0ANativePipeline({ bytes, context, indexedPages: cachedPages });
  assert.deepEqual(semanticPipelineProjection(secondResult), semanticPipelineProjection(firstResult));
  const secondPersisted = await persistP0AShadowResult(prisma, {
    documentId: document.id,
    companyId: company.id,
    context,
    result: secondResult,
  });
  const secondRead = await readExtractionQa(prisma, { passId: secondPersisted.passId });
  assert.ok(secondRead);
  assertExactCompatibilityRoundTrip(secondResult, secondRead, document.id);
  const secondCounts = await p0aCounts(document.id, secondPersisted.passId);
  const legacyAfter = await legacySnapshot();

  assert.equal(secondPersisted.passId, firstPersisted.passId);
  assert.deepEqual(secondCounts, firstCounts);
  assert.deepEqual(stableQaProjection(secondRead), stableQaProjection(firstRead));
  assert.deepEqual(legacyAfter, legacyBefore);
  assert.equal(firstRead.summary.reportRevisionId, secondRead.summary.reportRevisionId);
  assert.equal(firstRead.summary.documentPages, 109);
  assert.deepEqual(firstRead.summary.selectedPages, EXPECTED_SELECTED_PAGES);
  assert.equal(firstRead.summary.valueZeroCount, 28);
  assert.equal(firstRead.summary.notApplicableCount, 1);
  assert.equal(firstRead.summary.notDisclosedCount, 5);
  assert.equal(firstRead.summary.missingCount, 0);
  assert.equal(firstRead.summary.ambiguousCount, 0);
  assert.equal(firstRead.summary.conflictCount, 0);
  assert.equal(firstRead.summary.providerCalls, 0);
  assert.equal(firstRead.summary.apiCostUsd, "0.00000000");
  assert.equal(firstRead.summary.shadowOnly, true);
  assert.equal(firstRead.summary.routingClassificationStatus, "AVAILABLE");
  assert.equal(firstResult.routedPages.length, 109);
  assert.equal(firstResult.usage.providerCalls, 0);
  assert.equal(secondResult.usage.providerCalls, 0);
  assert.equal(firstCounts.pages, 109);
  assert.equal(firstCounts.passes, 1);
  assert.equal(firstCounts.revisions, 1);
  assert.equal(firstCounts.outcomes, 34);
  assert.equal(firstCounts.assertions, 29);
  assert.equal(firstRead.facts.filter((fact) => fact.source === "AI").length, 0);
  for (const requirementId of ["AR_REPORTED", "AP_REPORTED", "SHORT_TERM_DEBT_REPORTED", "LONG_TERM_DEBT_REPORTED"]) {
    const fact: ExtractionQaFact | undefined = firstRead.facts.find((item) => item.requirementId === requirementId);
    assert.equal(fact?.state, "NOT_DISCLOSED", `${requirementId} direct reported state`);
    assert.equal(fact?.origin, null, `${requirementId} aggregate must not persist as REPORTED`);
    assert.equal(fact?.standardizedAlternativeAvailable, true, `${requirementId} transient aggregate marker`);
  }
  assert.equal(nativeMetrics.incorrectFacts.length, 0);
  assert.equal(nativeMetrics.digitAndSignAccuracyPct, 100);
  assert.equal(nativeMetrics.unitAndScaleAccuracyPct, 100);
  assert.equal(nativeMetrics.periodAccuracyPct, 100);
  assert.equal(nativeMetrics.consolidationScopeAccuracyPct, 100);
  assert.equal(nativeMetrics.evidenceCompletenessPct, 100);

  console.log(JSON.stringify({
    fixture: { sha256: actualSha, documentPages: firstRead.summary.documentPages },
    summary: firstRead.summary,
    versions: firstRead.versions,
    exactRoundTrip: {
      valuesSignsScalePeriodScope: true,
      evidencePageSnippetHashes: true,
      semanticStates: true,
      lineage: true,
    },
    idempotency: {
      passId: firstPersisted.passId,
      reportRevisionId: firstRead.summary.reportRevisionId,
      firstCounts,
      secondCounts,
      deterministic: true,
      cachedPageIndexOnSecondRun: secondResult.pageIndexCacheHit,
    },
    legacyMutationProof: { before: legacyBefore, after: legacyAfter, unchanged: true },
    arApDebtRule: "NOT_DISCLOSED; transient STANDARDIZED_AGGREGATE not persisted as REPORTED",
    providerCalls: firstResult.usage.providerCalls + secondResult.usage.providerCalls,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
