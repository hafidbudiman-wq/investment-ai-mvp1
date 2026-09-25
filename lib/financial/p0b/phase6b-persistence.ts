import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { P0AEvidence } from "@/lib/financial/p0a/types";
import type { Phase6BResult } from "@/lib/financial/p0b/phase6b-types";

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const date = (value: string | null): Date | null => value ? new Date(`${value}T00:00:00.000Z`) : null;

export type Phase6BPersistenceInput = {
  documentId: string;
  companyId: string;
  reportRevisionId: string;
  result: Phase6BResult;
};

export async function persistPhase6B(client: PrismaClient, input: Phase6BPersistenceInput) {
  return client.$transaction(async (tx) => {
    const run = await tx.phase6BExtractionRun.upsert({
      where: { completeIdentityHash: input.result.runIdentity },
      create: {
        companyId: input.companyId,
        documentId: input.documentId,
        reportRevisionId: input.reportRevisionId,
        manifestVersion: input.result.manifestVersion,
        extractorVersion: input.result.extractorVersion,
        dimensionSchemaVersion: input.result.dimensionSchemaVersion,
        completeIdentityHash: input.result.runIdentity,
        status: "SUCCEEDED",
        selectedPages: json(input.result.selectedPages),
        providerCalls: input.result.providerUsage.providerCalls,
        inputTokens: input.result.providerUsage.inputTokens,
        outputTokens: input.result.providerUsage.outputTokens,
        estimatedCostUsd: new Prisma.Decimal(input.result.providerUsage.costUsd),
        completedAt: new Date(),
      },
      update: {},
    });

    const pages = await tx.p0ADocumentPage.findMany({
      where: { documentId: input.documentId, parserVersion: input.result.p0a.versions.parser },
      select: { id: true, pageNumber: true },
    });
    const pageIds = new Map(pages.map((page) => [page.pageNumber, page.id]));
    const evidenceIds = new Map<string, string>();
    const persistEvidence = async (evidence: P0AEvidence): Promise<string> => {
      const evidenceHash = evidence.evidenceHash ?? sha([input.documentId, evidence.locatorHash, evidence.snippetHash].join("|"));
      const cached = evidenceIds.get(evidenceHash);
      if (cached) return cached;
      const stored = await tx.p0AFactEvidence.upsert({
        where: { evidenceHash },
        create: {
          documentId: input.documentId,
          pageId: pageIds.get(evidence.pageNumber),
          evidenceHash,
          pageNumber: evidence.pageNumber,
          printedPageLabel: evidence.printedPageLabel,
          statement: evidence.statement,
          tableName: evidence.table,
          rowLabel: evidence.rowLabel,
          columnLabel: evidence.columnLabel,
          rawValue: evidence.rawValue,
          snippet: evidence.snippet,
          snippetHash: evidence.snippetHash,
          locatorHash: evidence.locatorHash,
          rowIndex: evidence.rowIndex,
          columnIndex: evidence.columnIndex,
        },
        update: {},
      });
      evidenceIds.set(evidenceHash, stored.id);
      return stored.id;
    };

    const segmentIds = new Map<string, string>();
    for (const identity of input.result.segmentIdentities) {
      const segment = await tx.segmentDimension.upsert({
        where: { identityKey: identity.identityKey },
        create: {
          companyId: input.companyId,
          identityKey: identity.identityKey,
          sourceLabel: identity.sourceLabel,
          normalizedLabel: identity.normalizedLabel,
          segmentType: identity.segmentType,
          validFrom: date(identity.validFrom)!,
          validTo: date(identity.validTo),
          definitionVersion: input.result.dimensionSchemaVersion,
        },
        update: {},
      });
      segmentIds.set(identity.identityKey, segment.id);
      for (const [ordinal, evidence] of identity.evidence.entries()) {
        const evidenceId = await persistEvidence(evidence);
        await tx.segmentIdentityEvidence.upsert({
          where: { segmentId_evidenceId: { segmentId: segment.id, evidenceId } },
          create: { segmentId: segment.id, evidenceId, ordinal },
          update: {},
        });
      }
    }

    for (const event of input.result.dividendEvents) {
      const stored = await tx.dividendEvent.upsert({
        where: { eventKey: event.eventKey },
        create: {
          runId: run.id,
          companyId: input.companyId,
          documentId: input.documentId,
          reportRevisionId: input.reportRevisionId,
          eventKey: event.eventKey,
          eventType: event.eventType,
          status: event.status,
          sourceProfitPeriodStart: date(event.sourceProfitPeriod.start),
          sourceProfitPeriodEnd: date(event.sourceProfitPeriod.end),
          declarationDate: date(event.dates.declaration),
          approvalDate: date(event.dates.approval),
          recordDate: date(event.dates.record),
          cumDate: date(event.dates.cum),
          exDate: date(event.dates.ex),
          paymentDate: date(event.dates.payment),
          paymentDatePrecision: event.dates.paymentPrecision,
          paymentDateRaw: event.dates.paymentRaw,
          recipientScope: event.recipientScope,
          shareClass: event.shareClass,
          totalReportedValue: event.total ? new Prisma.Decimal(event.total.reportedValue) : null,
          totalAmount: event.total ? new Prisma.Decimal(event.total.normalizedValue) : null,
          totalRawValue: event.total?.rawValue,
          totalCurrency: event.total?.currency,
          totalScale: event.total ? new Prisma.Decimal(event.total.scale) : null,
          perShareReportedValue: event.perShare ? new Prisma.Decimal(event.perShare.reportedValue) : null,
          perShareAmount: event.perShare ? new Prisma.Decimal(event.perShare.normalizedValue) : null,
          perShareRawValue: event.perShare?.rawValue,
          perShareCurrency: event.perShare?.currency,
          perShareScale: event.perShare ? new Prisma.Decimal(event.perShare.scale) : null,
          fieldStates: json(event.fieldStates),
          definitionVersion: input.result.manifestVersion,
          sourceRevisionHash: input.result.documentSha256,
          extractionOrigin: event.extractionOrigin,
          readConfidence: new Prisma.Decimal(event.confidence.read),
          mappingConfidence: new Prisma.Decimal(event.confidence.mapping),
          validationStatus: event.validation.status,
          validationControls: json(event.validation.controls),
        },
        update: {},
      });
      for (const [ordinal, link] of event.evidence.entries()) {
        const evidenceId = await persistEvidence(link.evidence);
        await tx.dividendEventEvidence.upsert({
          where: { eventId_evidenceId_fieldName: { eventId: stored.id, evidenceId, fieldName: link.fieldName } },
          create: { eventId: stored.id, evidenceId, fieldName: link.fieldName, ordinal },
          update: {},
        });
      }
    }

    for (const fact of input.result.segmentFacts) {
      const segmentId = segmentIds.get(fact.segmentIdentityKey);
      if (!segmentId) throw new Error(`Missing segment identity ${fact.segmentIdentityKey}`);
      const stored = await tx.segmentFact.upsert({
        where: { factKey: fact.factKey },
        create: {
          runId: run.id,
          companyId: input.companyId,
          documentId: input.documentId,
          reportRevisionId: input.reportRevisionId,
          segmentId,
          factKey: fact.factKey,
          metricCode: fact.metricCode,
          metricLabel: fact.metricLabel,
          sourceMetricLabel: fact.sourceMetricLabel,
          periodColumn: fact.periodColumn,
          salesScope: fact.salesScope,
          valueState: fact.state,
          reportedValue: new Prisma.Decimal(fact.reportedValue),
          normalizedValue: new Prisma.Decimal(fact.normalizedValue),
          rawValue: fact.rawValue,
          currency: fact.currency,
          unitType: fact.unitType,
          scale: new Prisma.Decimal(fact.scale),
          periodStart: date(fact.period.start)!,
          periodEnd: date(fact.period.end)!,
          periodType: fact.period.type,
          consolidationScope: fact.consolidationScope,
          dimensionSchemaVersion: input.result.dimensionSchemaVersion,
          dimensionHash: fact.dimensionHash,
          definitionVersion: input.result.manifestVersion,
          sourceRevisionHash: fact.sourceDocumentSha256,
          origin: "REPORTED",
          extractionOrigin: fact.extractionOrigin,
          readConfidence: new Prisma.Decimal(fact.confidence.read),
          mappingConfidence: new Prisma.Decimal(fact.confidence.mapping),
          validationStatus: fact.validationStatus,
        },
        update: {},
      });
      for (const [ordinal, evidence] of fact.evidence.entries()) {
        const evidenceId = await persistEvidence(evidence);
        await tx.segmentFactEvidence.upsert({
          where: { factId_evidenceId: { factId: stored.id, evidenceId } },
          create: { factId: stored.id, evidenceId, ordinal },
          update: {},
        });
      }
    }

    for (const outcome of input.result.outcomes) {
      await tx.phase6BRequirementOutcome.upsert({
        where: { runId_requirementId: { runId: run.id, requirementId: outcome.requirementId } },
        create: { runId: run.id, requirementId: outcome.requirementId, applicability: outcome.applicability, state: outcome.state, factCount: outcome.factCount, reason: outcome.reason, attemptedPages: json(outcome.attemptedPages) },
        update: {},
      });
    }

    return {
      runId: run.id,
      counts: {
        runs: await tx.phase6BExtractionRun.count({ where: { completeIdentityHash: input.result.runIdentity } }),
        outcomes: await tx.phase6BRequirementOutcome.count({ where: { runId: run.id } }),
        dividendEvents: await tx.dividendEvent.count({ where: { runId: run.id } }),
        dividendEvidence: await tx.dividendEventEvidence.count({ where: { event: { runId: run.id } } }),
        segmentDimensions: await tx.segmentDimension.count({ where: { companyId: input.companyId, validFrom: date(input.result.context.periodStart)!, validTo: date(input.result.context.periodEnd) } }),
        segmentFacts: await tx.segmentFact.count({ where: { runId: run.id } }),
        segmentIdentityEvidence: await tx.segmentIdentityEvidence.count({ where: { segment: { companyId: input.companyId, validFrom: date(input.result.context.periodStart)!, validTo: date(input.result.context.periodEnd) } } }),
        segmentFactEvidence: await tx.segmentFactEvidence.count({ where: { fact: { runId: run.id } } }),
      },
    };
  }, { timeout: 60_000 });
}
