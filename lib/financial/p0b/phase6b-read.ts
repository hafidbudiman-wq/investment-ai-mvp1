import type { PrismaClient } from "@prisma/client";

const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;

/**
 * Compatibility read for Phase 6B. Event and dimensional truth remains
 * separate from the legacy scalar FinancialEntry projection.
 */
export async function readPhase6B(client: PrismaClient, completeIdentityHash: string) {
  const run = await client.phase6BExtractionRun.findUnique({
    where: { completeIdentityHash },
    include: {
      company: { select: { ticker: true } },
      outcomes: { orderBy: { requirementId: "asc" } },
      dividendEvents: {
        orderBy: { eventKey: "asc" },
        include: { evidence: { orderBy: { ordinal: "asc" }, include: { evidence: true } } },
      },
      segmentFacts: {
        orderBy: [{ metricCode: "asc" }, { salesScope: "asc" }, { factKey: "asc" }],
        include: {
          segment: { include: { evidence: { orderBy: { ordinal: "asc" }, include: { evidence: true } } } },
          evidence: { orderBy: { ordinal: "asc" }, include: { evidence: true } },
        },
      },
    },
  });
  if (!run) return null;
  return {
    run: {
      identity: run.completeIdentityHash,
      ticker: run.company.ticker,
      manifestVersion: run.manifestVersion,
      extractorVersion: run.extractorVersion,
      dimensionSchemaVersion: run.dimensionSchemaVersion,
      selectedPages: run.selectedPages,
      providerUsage: { calls: run.providerCalls, inputTokens: run.inputTokens, outputTokens: run.outputTokens, costUsd: run.estimatedCostUsd.toFixed(8) },
    },
    outcomes: run.outcomes.map((outcome) => ({ requirementId: outcome.requirementId, applicability: outcome.applicability, state: outcome.state, factCount: outcome.factCount, reason: outcome.reason, attemptedPages: outcome.attemptedPages })),
    dividendEvents: run.dividendEvents.map((event) => ({
      eventKey: event.eventKey,
      eventType: event.eventType,
      status: event.status,
      sourceProfitPeriod: { start: day(event.sourceProfitPeriodStart), end: day(event.sourceProfitPeriodEnd) },
      dates: { declaration: day(event.declarationDate), approval: day(event.approvalDate), record: day(event.recordDate), cum: day(event.cumDate), ex: day(event.exDate), payment: day(event.paymentDate), precision: event.paymentDatePrecision, raw: event.paymentDateRaw },
      recipientScope: event.recipientScope,
      shareClass: event.shareClass,
      total: event.totalAmount ? { reported: event.totalReportedValue?.toFixed(), normalized: event.totalAmount.toFixed(), raw: event.totalRawValue, currency: event.totalCurrency, scale: event.totalScale?.toFixed() } : null,
      perShare: event.perShareAmount ? { reported: event.perShareReportedValue?.toFixed(), normalized: event.perShareAmount.toFixed(), raw: event.perShareRawValue, currency: event.perShareCurrency, scale: event.perShareScale?.toFixed() } : null,
      fieldStates: event.fieldStates,
      origin: event.extractionOrigin,
      evidence: event.evidence.map((link) => ({ fieldName: link.fieldName, ...link.evidence })),
    })),
    segmentFacts: run.segmentFacts.map((fact) => ({
      factKey: fact.factKey,
      segment: { identityKey: fact.segment.identityKey, sourceLabel: fact.segment.sourceLabel, normalizedLabel: fact.segment.normalizedLabel, type: fact.segment.segmentType, validFrom: day(fact.segment.validFrom), validTo: day(fact.segment.validTo), evidence: fact.segment.evidence.map((link) => link.evidence) },
      metricCode: fact.metricCode,
      metricLabel: fact.metricLabel,
      sourceMetricLabel: fact.sourceMetricLabel,
      periodColumn: fact.periodColumn,
      salesScope: fact.salesScope,
      state: fact.valueState,
      reportedValue: fact.reportedValue.toFixed(),
      normalizedValue: fact.normalizedValue.toFixed(),
      rawValue: fact.rawValue,
      currency: fact.currency,
      scale: fact.scale.toFixed(),
      period: { start: day(fact.periodStart), end: day(fact.periodEnd), type: fact.periodType },
      consolidationScope: fact.consolidationScope,
      dimensionHash: fact.dimensionHash,
      sourceRevisionHash: fact.sourceRevisionHash,
      origin: fact.origin,
      extractionOrigin: fact.extractionOrigin,
      evidence: fact.evidence.map((link) => link.evidence),
    })),
  };
}
