import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { P0APipelineResult } from "@/lib/financial/p0a/pipeline";
import {
  assertRoutingSnapshotIdentity,
  createRoutingSnapshot,
} from "@/lib/financial/p0a/routing-snapshot";
import type { P0AIssuerContext, P0ANativeObservation, P0AProviderAttemptUsage } from "@/lib/financial/p0a/types";
import type { P0AIndexedPage } from "@/lib/financial/p0a/types";

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

export type P0APersistenceCounts = {
  pages: number;
  passes: number;
  tasks: number;
  outcomes: number;
  revisions: number;
  reportedAssertions: number;
  evidence: number;
};

export async function loadCachedP0APageIndex(client: PrismaClient, documentId: string, parserVersion: string): Promise<P0AIndexedPage[] | null> {
  const rows = await client.p0ADocumentPage.findMany({ where: { documentId, parserVersion }, orderBy: { pageNumber: "asc" } });
  if (!rows.length || rows.some((row, index) => row.pageNumber !== index + 1 || !Array.isArray(row.tokens))) return null;
  return rows.map((row) => ({
    pageNumber: row.pageNumber, width: row.pageWidth, height: row.pageHeight,
    text: row.text, normalizedText: row.text.normalize("NFKC").replace(/\u00a0/g, " ").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").trim(),
    textHash: row.textHash, layoutHash: row.layoutHash, printedPageLabel: row.printedPageLabel,
    tokens: row.tokens as unknown as P0AIndexedPage["tokens"],
    extractionStatus: row.extractionStatus as P0AIndexedPage["extractionStatus"],
  }));
}

/**
 * Persists only issuer-reported facts. STANDARDIZED_AGGREGATE alternatives and
 * all validation calculations remain transient until the separately scoped P0-B.
 */
export async function persistP0AShadowResult(
  client: PrismaClient,
  input: { documentId: string; companyId: string; jobId?: string; context: P0AIssuerContext; result: P0APipelineResult },
): Promise<{ passId: string; counts: P0APersistenceCounts }> {
  const { documentId, companyId, context, result } = input;
  return client.$transaction(async (tx) => {
    for (const page of result.routedPages) {
      await tx.p0ADocumentPage.upsert({
        where: { documentId_pageNumber_parserVersion: { documentId, pageNumber: page.pageNumber, parserVersion: result.versions.parser } },
        create: {
          documentId, pageNumber: page.pageNumber, pageWidth: page.width, pageHeight: page.height, parserVersion: result.versions.parser,
          text: page.text, textHash: page.textHash, layoutHash: page.layoutHash,
          printedPageLabel: page.printedPageLabel, pageClass: page.pageClass,
          classifierVersion: result.versions.router, extractionStatus: page.extractionStatus,
          characterCount: page.text.length, tokens: json(page.tokens),
        },
        update: {
          pageWidth: page.width, pageHeight: page.height, text: page.text, textHash: page.textHash, layoutHash: page.layoutHash,
          printedPageLabel: page.printedPageLabel, pageClass: page.pageClass,
          classifierVersion: result.versions.router, extractionStatus: page.extractionStatus,
          characterCount: page.text.length, tokens: json(page.tokens),
        },
      });
    }

    const identity = {
      documentId,
      contractVersion: result.versions.contract,
      parserVersion: result.versions.parser,
      routerVersion: result.versions.router,
      applicabilityVersion: result.versions.applicability,
      plannerVersion: result.versions.planner,
      gapVersion: result.versions.gapDetector,
      validationVersion: result.versions.validation,
      mappingVersion: result.versions.mapping,
      scopedPromptVersion: result.versions.scopedPrompt,
      contextHash: result.contextHash,
      shadowMode: true,
    };
    const routingSnapshot = createRoutingSnapshot(result.routedPages);
    const pass = await tx.p0AExtractionPass.upsert({
      where: { completeIdentity: identity },
      create: {
        ...identity,
        sourceSha256: result.documentSha256,
        pageIndexCacheHit: result.pageIndexCacheHit,
        status: "SUCCEEDED",
        primaryPages: json(result.tasks.filter((task) => task.stage === "PRIMARY").flatMap((task) => task.selectedPages)),
        targetedPages: json(result.tasks.filter((task) => task.stage === "TARGETED").flatMap((task) => task.selectedPages)),
        selectedPages: json(result.selectedPages),
        routingSnapshot: json(routingSnapshot),
        completedAt: new Date(),
      },
      update: {
        pageIndexCacheHit: result.pageIndexCacheHit,
        status: "SUCCEEDED",
        primaryPages: json(result.tasks.filter((task) => task.stage === "PRIMARY").flatMap((task) => task.selectedPages)),
        targetedPages: json(result.tasks.filter((task) => task.stage === "TARGETED").flatMap((task) => task.selectedPages)),
        selectedPages: json(result.selectedPages),
        completedAt: new Date(),
      },
    });
    assertRoutingSnapshotIdentity(pass.routingSnapshot, routingSnapshot);

    const revision = await tx.p0AReportRevision.upsert({
      where: { passId: pass.id },
      create: {
        companyId, documentId, passId: pass.id, contextHash: result.contextHash,
        periodStart: new Date(context.periodStart), periodEnd: new Date(context.periodEnd),
        periodType: context.periodType, currency: context.currency,
        documentScale: new Prisma.Decimal(context.documentScale),
        consolidated: context.consolidated, audited: context.audited, status: "SHADOW",
      },
      update: { status: "SHADOW" },
    });

    for (const task of result.tasks) {
      const taskObservations = result.observations.filter((item) =>
        task.requirementIds.includes(item.requirementId)
        && item.evidence.some((evidence) => task.selectedPages.includes(evidence.pageNumber))
      );
      await tx.p0AExtractionTask.upsert({
        where: { taskKey: task.cacheKey },
        create: {
          passId: pass.id, jobId: task.stage === "PRIMARY" ? input.jobId : undefined,
          stage: task.stage, route: task.route, taskKey: task.cacheKey,
          requirementIds: json(task.requirementIds), selectedPages: json(task.selectedPages),
          selectedPageCount: task.selectedPages.length, requirementCount: task.requirementIds.length,
          documentPageCount: result.routedPages.length,
          validatedFactCount: taskObservations.filter((item) => item.origin === "REPORTED").length,
          executionMode: "SCOPED_PAGE", status: "SUCCEEDED",
          provider: null, model: null, providerRequestId: null, providerResponseId: null,
          retryCount: 0, inputTokens: null, outputTokens: null,
          processingLatencyMs: task.stage === "PRIMARY" ? result.usage.processingLatencyMs : 0,
          estimatedCostUsd: null, billedCostUsd: null, providerCalls: 0,
          inputHash: task.cacheKey, outputHash: sha(JSON.stringify(taskObservations)),
        },
        update: {
          passId: pass.id, status: "SUCCEEDED", selectedPageCount: task.selectedPages.length,
          requirementCount: task.requirementIds.length, documentPageCount: result.routedPages.length,
          validatedFactCount: taskObservations.filter((item) => item.origin === "REPORTED").length,
          executionMode: "SCOPED_PAGE",
          processingLatencyMs: task.stage === "PRIMARY" ? result.usage.processingLatencyMs : 0,
          outputHash: sha(JSON.stringify(taskObservations)),
        },
      });
    }

    const pageRows = await tx.p0ADocumentPage.findMany({ where: { documentId, parserVersion: result.versions.parser } });
    const pageIds = new Map(pageRows.map((page) => [page.pageNumber, page.id]));
    const assertionIds = new Map<string, string>();
    for (const observation of result.observations.filter((item) => item.origin === "REPORTED" && ["VALUE", "ZERO", "NOT_APPLICABLE"].includes(item.state))) {
      const native = observation as Partial<P0ANativeObservation>;
      const assertionKey = sha([revision.id, observation.requirementId, observation.state, observation.decimalValue, observation.rawValue, result.versions.contract].join("|"));
      const assertion = await tx.p0AFactAssertion.upsert({
        where: { reportRevisionId_requirementId: { reportRevisionId: revision.id, requirementId: observation.requirementId } },
        create: {
          companyId, reportRevisionId: revision.id, requirementId: observation.requirementId,
          definitionVersion: result.versions.contract, assertionKey, origin: "REPORTED",
          rawLabel: native.rawLabel, statement: native.statement,
          readConfidence: native.readConfidence === undefined ? undefined : new Prisma.Decimal(native.readConfidence),
          mappingConfidence: native.mappingConfidence === undefined ? undefined : new Prisma.Decimal(native.mappingConfidence),
          valueState: observation.state, decimalValue: observation.decimalValue === null ? null : new Prisma.Decimal(observation.decimalValue),
          rawValue: observation.rawValue, currency: observation.currency, unitType: observation.unitType,
          scale: new Prisma.Decimal(observation.scale), lineageStatus: "COMPLETE", status: "SHADOW",
        },
        update: {
          assertionKey, valueState: observation.state,
          rawLabel: native.rawLabel, statement: native.statement,
          readConfidence: native.readConfidence === undefined ? undefined : new Prisma.Decimal(native.readConfidence),
          mappingConfidence: native.mappingConfidence === undefined ? undefined : new Prisma.Decimal(native.mappingConfidence),
          decimalValue: observation.decimalValue === null ? null : new Prisma.Decimal(observation.decimalValue),
          rawValue: observation.rawValue, currency: observation.currency, unitType: observation.unitType,
          scale: new Prisma.Decimal(observation.scale), lineageStatus: "COMPLETE", status: "SHADOW",
        },
      });
      assertionIds.set(observation.requirementId, assertion.id);
      await tx.p0AFactAssertionEvidence.deleteMany({ where: { assertionId: assertion.id } });
      for (const [ordinal, evidence] of observation.evidence.entries()) {
        const evidenceHash = sha([documentId, evidence.locatorHash, evidence.snippetHash].join("|"));
        const stored = await tx.p0AFactEvidence.upsert({
          where: { evidenceHash },
          create: {
            documentId, pageId: pageIds.get(evidence.pageNumber), evidenceHash,
            pageNumber: evidence.pageNumber, printedPageLabel: evidence.printedPageLabel,
            statement: evidence.statement, tableName: evidence.table, rowLabel: evidence.rowLabel,
            columnLabel: evidence.columnLabel, rawValue: evidence.rawValue, snippet: evidence.snippet,
            snippetHash: evidence.snippetHash, locatorHash: evidence.locatorHash,
            rowIndex: evidence.rowIndex, columnIndex: evidence.columnIndex,
          },
          // Evidence is content-addressed and shared across compatible passes.
          // Never move or rewrite an older evidence row when a newer parser or
          // router pass cites the same immutable evidence hash.
          update: {},
        });
        await tx.p0AFactAssertionEvidence.create({ data: { assertionId: assertion.id, evidenceId: stored.id, ordinal } });
      }
    }

    for (const outcome of result.outcomes) {
      await tx.p0ARequirementOutcome.upsert({
        where: { passId_requirementId: { passId: pass.id, requirementId: outcome.requirementId } },
        create: {
          passId: pass.id, requirementId: outcome.requirementId, applicability: outcome.applicability,
          state: outcome.state, reportedAssertionId: assertionIds.get(outcome.requirementId),
          attemptedRoutes: json(outcome.attemptedRoutes), attemptedPages: json(outcome.attemptedPages), reason: outcome.reason,
        },
        update: {
          applicability: outcome.applicability, state: outcome.state,
          reportedAssertionId: assertionIds.get(outcome.requirementId) ?? null,
          attemptedRoutes: json(outcome.attemptedRoutes), attemptedPages: json(outcome.attemptedPages), reason: outcome.reason,
        },
      });
    }

    return {
      passId: pass.id,
      counts: {
        pages: await tx.p0ADocumentPage.count({ where: { documentId } }),
        passes: await tx.p0AExtractionPass.count({ where: { documentId } }),
        tasks: await tx.p0AExtractionTask.count({ where: { passId: pass.id } }),
        outcomes: await tx.p0ARequirementOutcome.count({ where: { passId: pass.id } }),
        revisions: await tx.p0AReportRevision.count({ where: { documentId } }),
        reportedAssertions: await tx.p0AFactAssertion.count({ where: { reportRevisionId: revision.id } }),
        evidence: await tx.p0AFactEvidence.count({ where: { documentId } }),
      },
    };
  }, { timeout: 60_000 });
}

/**
 * Records one approval-gated scoped provider attempt only on the existing P0-A
 * shadow task. It has no code path to FinancialEntry or FinancialReport.
 */
export async function persistP0AScopedTaskUsage(
  client: PrismaClient,
  input: { taskKey: string; usage: P0AProviderAttemptUsage; errorCode?: string; errorMessage?: string },
): Promise<void> {
  await client.p0AExtractionTask.update({
    where: { taskKey: input.taskKey },
    data: {
      status: input.usage.status,
      provider: input.usage.provider,
      model: input.usage.model,
      selectedPageCount: input.usage.selectedPageCount,
      requirementCount: input.usage.requirementCount,
      providerRequestId: input.usage.providerRequestId,
      providerResponseId: input.usage.providerResponseId,
      retryCount: input.usage.retryCount,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      processingLatencyMs: input.usage.processingLatencyMs,
      estimatedCostUsd: input.usage.estimatedCostUsd === null ? null : new Prisma.Decimal(input.usage.estimatedCostUsd),
      billedCostUsd: input.usage.billedCostUsd === null ? null : new Prisma.Decimal(input.usage.billedCostUsd),
      providerCalls: input.usage.providerCalls,
      inputHash: input.usage.inputHash,
      outputHash: input.usage.outputHash,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage?.slice(0, 2_000),
    },
  });
}
