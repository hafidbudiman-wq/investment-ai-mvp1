import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { readExtractionQa } from "../../lib/financial/p0a/compatibility-read";
import { persistP0AShadowResult } from "../../lib/financial/p0a/persistence";
import type { P0APipelineResult } from "../../lib/financial/p0a/pipeline";
import { ROUTING_SNAPSHOT_IDENTITY_CONFLICT } from "../../lib/financial/p0a/routing-snapshot";
import type { P0AIssuerContext, P0ANativeObservation, P0ARoutedPage } from "../../lib/financial/p0a/types";
import { P0A_VERSION_SET } from "../../lib/financial/p0a/versions";

const databaseUrl = process.env.PHASE4_TEST_DATABASE_URL;

const context: P0AIssuerContext = {
  ticker: "P4TEST",
  issuerType: "LISTED_COMMON_EQUITY",
  accountingModel: "NON_FINANCIAL",
  consolidated: true,
  audited: false,
  periodStart: "2025-01-01",
  periodEnd: "2025-06-30",
  periodType: "H1",
  currency: "IDR",
  documentScale: "1000000",
};

type Versions = P0APipelineResult["versions"];

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function versionSet(overrides: Partial<Record<keyof Versions, string>> = {}): Versions {
  return { ...P0A_VERSION_SET, ...overrides } as Versions;
}

function makeResult(
  versions: Versions = versionSet(),
  pageClass: P0ARoutedPage["pageClass"] = "PRIMARY_INCOME_STATEMENT",
): P0APipelineResult {
  const page: P0ARoutedPage = {
    pageNumber: 1,
    width: 600,
    height: 800,
    text: "Revenue 100",
    normalizedText: "revenue 100",
    textHash: "1".repeat(64),
    layoutHash: "2".repeat(64),
    printedPageLabel: "1",
    tokens: [],
    extractionStatus: "NATIVE_TEXT",
    pageClass,
    statementType: pageClass === "PRIMARY_INCOME_STATEMENT" ? "INCOME_STATEMENT" : "OTHER",
    confidence: pageClass === "PRIMARY_INCOME_STATEMENT" ? 0.99 : 0.7,
    matchedAnchors: pageClass === "PRIMARY_INCOME_STATEMENT" ? ["statement of profit or loss"] : [],
  };
  const evidence = {
    requirementId: "REV_REPORTED",
    pageNumber: 1,
    printedPageLabel: "1",
    statement: "INCOME_STATEMENT",
    table: "Statement of profit or loss",
    rowLabel: "Revenue",
    columnLabel: "30 June 2025",
    rawValue: "100",
    snippet: "Revenue 100",
    snippetHash: hash("Revenue 100"),
    evidenceHash: hash("REV_REPORTED|Revenue 100"),
    locatorHash: hash("1|Revenue|30 June 2025|100"),
    rowIndex: 1,
    columnIndex: 1,
  };
  const observation: P0ANativeObservation = {
    requirementId: "REV_REPORTED",
    origin: "REPORTED",
    state: "VALUE",
    decimalValue: "100",
    rawValue: "100",
    currency: "IDR",
    unitType: "DOCUMENT_CURRENCY",
    scale: "1000000",
    evidence: [evidence],
    rawLabel: "Revenue",
    statement: "INCOME_STATEMENT",
    period: { start: context.periodStart, end: context.periodEnd, type: "H1", nature: "DURATION" },
    consolidationScope: "CONSOLIDATED",
    readConfidence: 0.99,
    mappingConfidence: 0.99,
    versions: {
      parser: versions.parser,
      router: versions.router,
      mapping: versions.mapping,
      validation: versions.validation,
    },
  };
  const taskKey = hash({
    document: "3".repeat(64),
    stage: "PRIMARY",
    pages: [1],
    requirements: ["REV_REPORTED"],
    versions,
  });
  return {
    documentSha256: "3".repeat(64),
    contextHash: "4".repeat(64),
    versions,
    routedPages: [page],
    tasks: [{
      stage: "PRIMARY",
      requirementIds: ["REV_REPORTED"],
      selectedPages: [1],
      route: "PRIMARY",
      cacheKey: taskKey,
    }],
    selectedPages: [1],
    observations: [observation],
    outcomes: [{
      requirementId: "REV_REPORTED",
      applicability: "EXPECTED",
      state: "VALUE",
      reportedObservation: observation,
      calculatedAlternative: null,
      attemptedRoutes: ["PRIMARY"],
      attemptedPages: [1],
      reason: "Evidence-backed reported observation validated.",
    }],
    validations: [],
    usage: {
      provider: null,
      model: null,
      selectedPageCount: 1,
      requirementCount: 1,
      providerRequestId: null,
      providerResponseId: null,
      retryCount: 0,
      inputTokens: null,
      outputTokens: null,
      processingLatencyMs: 7,
      estimatedCostUsd: null,
      billedCostUsd: null,
      providerCalls: 0,
    },
    shadowMode: true,
    realProviderExtractionPassed: false,
    pageIndexCacheHit: false,
  };
}

async function immutablePassGraph(client: PrismaClient, passId: string) {
  const pass = await client.p0AExtractionPass.findUniqueOrThrow({
    where: { id: passId },
    include: {
      reportRevision: { include: { factAssertions: { include: { evidence: true } } } },
      outcomes: { orderBy: { requirementId: "asc" } },
      tasks: { orderBy: { taskKey: "asc" } },
    },
  });
  return JSON.parse(JSON.stringify(pass)) as unknown;
}

test("Phase 4 complete identity, routing snapshot, revision, and lineage are immutable", {
  skip: databaseUrl ? false : "PHASE4_TEST_DATABASE_URL is required for isolated PostgreSQL integration.",
}, async () => {
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  const suffix = randomUUID();
  let companyId: string | undefined;
  let documentId: string | undefined;
  try {
    const company = await client.company.create({
      data: { ticker: ("P4" + suffix.replaceAll("-", "")).slice(0, 16), name: "Phase 4 Test", currency: "IDR" },
    });
    companyId = company.id;
    const document = await client.financialDocument.create({
      data: {
        storageProvider: "isolated-test",
        bucket: "p0a-shadow",
        objectKey: "phase4/" + suffix + ".pdf",
        originalFileName: "phase4-test.pdf",
        mimeType: "application/pdf",
        verifiedSize: 12,
        sha256: "3".repeat(64),
        content: Buffer.from("%PDF-phase4"),
        magicBytesVerified: true,
        status: "VERIFIED",
        verifiedAt: new Date(),
      },
    });
    documentId = document.id;

    const firstResult = makeResult();
    const first = await persistP0AShadowResult(client, {
      documentId: document.id,
      companyId: company.id,
      context,
      result: firstResult,
    });
    const firstRevision = await client.p0AReportRevision.findUniqueOrThrow({ where: { passId: first.passId } });

    const repeat = await persistP0AShadowResult(client, {
      documentId: document.id,
      companyId: company.id,
      context,
      result: firstResult,
    });
    const repeatRevision = await client.p0AReportRevision.findUniqueOrThrow({ where: { passId: repeat.passId } });
    assert.equal(repeat.passId, first.passId);
    assert.equal(repeatRevision.id, firstRevision.id);
    assert.equal(await client.p0AExtractionPass.count({ where: { documentId: document.id } }), 1);
    assert.equal(await client.p0AReportRevision.count({ where: { documentId: document.id } }), 1);
    const stableFirstGraph = await immutablePassGraph(client, first.passId);

    const conflictingResult = makeResult(versionSet(), "OTHER");
    await assert.rejects(
      () => persistP0AShadowResult(client, {
        documentId: document.id,
        companyId: company.id,
        context,
        result: conflictingResult,
      }),
      (error: unknown) => error instanceof Error && error.message.includes(ROUTING_SNAPSHOT_IDENTITY_CONFLICT),
    );
    assert.deepEqual(await immutablePassGraph(client, first.passId), stableFirstGraph);

    const routerResult = makeResult(versionSet({ router: "p0a-page-router-v2" }), "OTHER");
    const routerPass = await persistP0AShadowResult(client, {
      documentId: document.id,
      companyId: company.id,
      context,
      result: routerResult,
    });
    assert.notEqual(routerPass.passId, first.passId);
    const routerRevision = await client.p0AReportRevision.findUniqueOrThrow({ where: { passId: routerPass.passId } });
    assert.notEqual(routerRevision.id, firstRevision.id);
    assert.deepEqual(await immutablePassGraph(client, first.passId), stableFirstGraph);

    const changedVersions: Array<[keyof Versions, string]> = [
      ["contract", "investai-canonical-v1.0-final:p0-a-test-v2"],
      ["parser", "p0a-native-page-index-v2"],
      ["applicability", "p0a-applicability-v2"],
      ["planner", "p0a-fact-planner-v2"],
      ["gapDetector", "p0a-gap-detector-v2"],
      ["validation", "p0a-validation-v2"],
      ["mapping", "p0a-native-financial-mapping-v2"],
      ["scopedPrompt", "p0a-scoped-openai-prompt-v2"],
    ];
    for (const [field, changed] of changedVersions) {
      const changedPass = await persistP0AShadowResult(client, {
        documentId: document.id,
        companyId: company.id,
        context,
        result: makeResult(versionSet({ [field]: changed })),
      });
      assert.notEqual(changedPass.passId, first.passId, field + " must create a new pass");
      const revision = await client.p0AReportRevision.findUniqueOrThrow({ where: { passId: changedPass.passId } });
      assert.notEqual(revision.id, firstRevision.id, field + " must create a new revision");
    }

    const firstAssertion = await client.p0AFactAssertion.findFirstOrThrow({
      where: { reportRevisionId: firstRevision.id, requirementId: "REV_REPORTED" },
      include: { evidence: true, outcome: true },
    });
    assert.equal(firstAssertion.outcome?.passId, first.passId);
    assert.equal(firstAssertion.evidence.length, 1);
    assert.deepEqual(await immutablePassGraph(client, first.passId), stableFirstGraph);

    const legacyPass = await client.p0AExtractionPass.create({
      data: {
        documentId: document.id,
        contractVersion: "legacy-contract",
        parserVersion: "legacy-parser",
        routerVersion: "legacy-router",
        applicabilityVersion: "legacy-applicability",
        plannerVersion: "legacy-planner",
        gapVersion: "legacy-gap",
        validationVersion: "legacy-validation",
        mappingVersion: "legacy-unversioned",
        scopedPromptVersion: "legacy-unversioned",
        contextHash: "5".repeat(64),
        sourceSha256: "3".repeat(64),
        shadowMode: true,
        pageIndexCacheHit: false,
        status: "SUCCEEDED",
        primaryPages: [],
        targetedPages: [],
        selectedPages: [],
      },
    });
    await client.p0AReportRevision.create({
      data: {
        companyId: company.id,
        documentId: document.id,
        passId: legacyPass.id,
        contextHash: legacyPass.contextHash,
        periodStart: new Date(context.periodStart),
        periodEnd: new Date(context.periodEnd),
        periodType: context.periodType,
        currency: context.currency,
        documentScale: context.documentScale,
        consolidated: context.consolidated,
        audited: context.audited,
        status: "SHADOW",
      },
    });
    const legacyRead = await readExtractionQa(client, { passId: legacyPass.id });
    assert.equal(legacyRead?.summary.routingClassificationStatus, "LEGACY_CLASSIFICATION_UNAVAILABLE");
    assert.equal((await client.p0AExtractionPass.findUniqueOrThrow({ where: { id: legacyPass.id } })).routingSnapshot, null);
  } finally {
    if (documentId) await client.financialDocument.delete({ where: { id: documentId } }).catch(() => undefined);
    if (companyId) await client.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await client.$disconnect();
  }
});
