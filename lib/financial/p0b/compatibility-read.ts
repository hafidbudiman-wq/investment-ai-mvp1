import type { PrismaClient } from "@prisma/client";

export type Phase6AReadQuery = { runId?: string; ticker?: string; year?: number; periodType?: string };

const include = {
  company: true,
  reportRevision: true,
  outcomes: {
    orderBy: { requirementId: "asc" as const },
    include: {
      reportedAssertion: { include: { evidence: { orderBy: { ordinal: "asc" as const }, include: { evidence: true } } } },
      derivedResult: {
        include: {
          definition: true,
          inputs: {
            orderBy: { ordinal: "asc" as const },
            include: { inputAssertion: true, inputResult: { include: { definition: true } } },
          },
        },
      },
    },
  },
};

/** Read-only P0-B view; it does not project calculated facts into legacy FinancialEntry. */
export async function readPhase6ACompatibility(client: PrismaClient, query: Phase6AReadQuery = {}) {
  const year = query.year ?? 2025;
  const run = query.runId
    ? await client.p0BExtractionRun.findUnique({ where: { id: query.runId }, include })
    : await client.p0BExtractionRun.findFirst({
      where: {
        company: { ticker: (query.ticker ?? "ICBP").trim().toUpperCase() },
        reportRevision: {
          periodType: (query.periodType ?? "H1").trim().toUpperCase(),
          periodEnd: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        },
      },
      orderBy: { createdAt: "desc" },
      include,
    });
  if (!run) return null;

  return {
    run: {
      id: run.id,
      completeIdentityHash: run.completeIdentityHash,
      ticker: run.company.ticker,
      manifestVersion: run.manifestVersion,
      extractorVersion: run.extractorVersion,
      formulaRegistryVersion: run.formulaRegistryVersion,
      providerCalls: run.providerCalls,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.estimatedCostUsd.toFixed(8),
      period: {
        start: run.reportRevision.periodStart.toISOString().slice(0, 10),
        end: run.reportRevision.periodEnd.toISOString().slice(0, 10),
        type: run.reportRevision.periodType,
        scope: run.reportRevision.consolidated === true ? "CONSOLIDATED" : run.reportRevision.consolidated === false ? "STANDALONE" : "UNKNOWN",
      },
    },
    facts: run.outcomes.map((outcome) => {
      const reported = outcome.reportedAssertion;
      const derived = outcome.derivedResult;
      return {
        requirementId: outcome.requirementId,
        family: outcome.family,
        applicability: outcome.applicability,
        state: outcome.state,
        reason: outcome.reason,
        value: reported?.decimalValue?.toString() ?? derived?.decimalValue.toString() ?? null,
        currency: reported?.currency ?? derived?.currency ?? null,
        unitType: reported?.unitType ?? derived?.unitType ?? null,
        scale: reported?.scale.toString() ?? derived?.scale.toString() ?? null,
        extractionOrigin: outcome.extractionOrigin,
        reportedLineage: reported ? {
          assertionId: reported.id,
          assertionKey: reported.assertionKey,
          definitionVersion: reported.definitionVersion,
          evidence: reported.evidence.map(({ evidence }) => ({
            evidenceId: evidence.id,
            evidenceHash: evidence.evidenceHash,
            pdfPage: evidence.pageNumber,
            rowLabel: evidence.rowLabel,
            columnLabel: evidence.columnLabel,
            rawValue: evidence.rawValue,
            snippetHash: evidence.snippetHash,
            locatorHash: evidence.locatorHash,
          })),
        } : null,
        calculatedLineage: derived ? {
          resultId: derived.id,
          resultHash: derived.resultHash,
          formulaId: derived.definition.code,
          formulaVersion: derived.definition.formulaVersion,
          expression: derived.definition.expression,
          calculationRunIdentity: derived.calculationRunIdentity,
          calculatedAt: derived.calculationTimestamp.toISOString(),
          inputs: derived.inputs.map((input) => ({
            ordinal: input.ordinal,
            role: input.inputRole,
            inputIdentity: input.inputIdentity,
            inputAssertionId: input.inputAssertionId,
            inputResultId: input.inputResultId,
            value: input.inputValue.toString(),
            extractionOrigin: input.inputExtractionOrigin,
            evidenceHashes: input.inputEvidenceHashes,
          })),
        } : null,
      };
    }),
  };
}
