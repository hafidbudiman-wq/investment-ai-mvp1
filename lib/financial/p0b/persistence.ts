import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PHASE6A_FORMULA_BY_CODE } from "@/lib/financial/p0b/phase6a-registry";
import type { Phase6AResult } from "@/lib/financial/p0b/types";

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export async function persistPhase6A(client: PrismaClient, input: { documentId: string; companyId: string; reportRevisionId: string; result: Phase6AResult }) {
  return client.$transaction(async (tx) => {
    const run = await tx.p0BExtractionRun.upsert({
      where: { completeIdentityHash: input.result.runIdentity },
      create: { companyId: input.companyId, documentId: input.documentId, reportRevisionId: input.reportRevisionId, manifestVersion: input.result.manifestVersion, extractorVersion: input.result.extractorVersion, formulaRegistryVersion: input.result.formulaRegistryVersion, completeIdentityHash: input.result.runIdentity, status: "SUCCEEDED", completedAt: new Date() },
      update: { status: "SUCCEEDED" },
    });
    const pages = await tx.p0ADocumentPage.findMany({ where: { documentId: input.documentId, parserVersion: input.result.p0a.versions.parser } });
    const pageIds = new Map(pages.map((page) => [page.pageNumber, page.id]));
    const assertionIds = new Map<string, string>();

    for (const outcome of input.result.outcomes.filter((item) => item.family === "REPORTED" && ["VALUE", "ZERO"].includes(item.state))) {
      if (!outcome.factIdentity || outcome.value === null || outcome.currency === null || outcome.scale === null) throw new Error(`Incomplete reported identity for ${outcome.requirementId}`);
      const assertion = await tx.p0AFactAssertion.upsert({
        where: { reportRevisionId_requirementId: { reportRevisionId: input.reportRevisionId, requirementId: outcome.requirementId } },
        create: { companyId: input.companyId, reportRevisionId: input.reportRevisionId, requirementId: outcome.requirementId, definitionVersion: input.result.manifestVersion, assertionKey: outcome.factIdentity.slice(5), origin: "REPORTED", rawLabel: outcome.evidence[0]?.rowLabel, statement: outcome.evidence[0]?.statement, readConfidence: outcome.confidence.read, mappingConfidence: outcome.confidence.mapping, valueState: outcome.state, decimalValue: new Prisma.Decimal(outcome.value), rawValue: outcome.rawValue ?? outcome.value, currency: outcome.currency, unitType: outcome.unitType, scale: new Prisma.Decimal(outcome.scale), lineageStatus: "COMPLETE", status: "SHADOW" },
        update: {},
      });
      assertionIds.set(outcome.factIdentity, assertion.id);
      for (const [ordinal, evidence] of outcome.evidence.entries()) {
        const evidenceHash = evidence.evidenceHash ?? sha([input.documentId, evidence.locatorHash, evidence.snippetHash].join("|"));
        const stored = await tx.p0AFactEvidence.upsert({ where: { evidenceHash }, create: { documentId: input.documentId, pageId: pageIds.get(evidence.pageNumber), evidenceHash, pageNumber: evidence.pageNumber, printedPageLabel: evidence.printedPageLabel, statement: evidence.statement, tableName: evidence.table, rowLabel: evidence.rowLabel, columnLabel: evidence.columnLabel, rawValue: evidence.rawValue, snippet: evidence.snippet, snippetHash: evidence.snippetHash, locatorHash: evidence.locatorHash, rowIndex: evidence.rowIndex, columnIndex: evidence.columnIndex }, update: {} });
        await tx.p0AFactAssertionEvidence.upsert({ where: { assertionId_evidenceId: { assertionId: assertion.id, evidenceId: stored.id } }, create: { assertionId: assertion.id, evidenceId: stored.id, ordinal }, update: {} });
      }
    }

    const calculatedFactInputs = new Map(input.result.outcomes
      .filter((item) => item.family === "CALCULATED")
      .flatMap((item) => item.inputs)
      .filter((item) => item.inputId.startsWith("fact:"))
      .map((item) => [item.inputId, item]));
    for (const metricInput of calculatedFactInputs.values()) {
      if (assertionIds.has(metricInput.inputId)) continue;
      const firstEvidence = metricInput.evidence[0];
      if (!firstEvidence) throw new Error(`Evidence-free calculation input ${metricInput.inputId}`);
      const assertion = await tx.p0AFactAssertion.upsert({
        where: { reportRevisionId_requirementId: { reportRevisionId: input.reportRevisionId, requirementId: metricInput.requirementId } },
        create: { companyId: input.companyId, reportRevisionId: input.reportRevisionId, requirementId: metricInput.requirementId, definitionVersion: input.result.manifestVersion, assertionKey: metricInput.inputId.slice(5), origin: "REPORTED", rawLabel: firstEvidence.rowLabel, statement: firstEvidence.statement, readConfidence: metricInput.extractionOrigin === "OCR" ? null : 1, mappingConfidence: 0.995, valueState: new Prisma.Decimal(metricInput.value).isZero() ? "ZERO" : "VALUE", decimalValue: new Prisma.Decimal(metricInput.value), rawValue: firstEvidence.rawValue, currency: metricInput.currency, unitType: metricInput.requirementId === "SHARES_OUTSTANDING_REPORTED" ? "SHARES" : "DOCUMENT_CURRENCY", scale: new Prisma.Decimal(metricInput.scale), lineageStatus: "COMPLETE", status: "SHADOW" },
        update: {},
      });
      assertionIds.set(metricInput.inputId, assertion.id);
      for (const [ordinal, evidence] of metricInput.evidence.entries()) {
        const evidenceHash = evidence.evidenceHash ?? sha([input.documentId, evidence.locatorHash, evidence.snippetHash].join("|"));
        const stored = await tx.p0AFactEvidence.upsert({ where: { evidenceHash }, create: { documentId: input.documentId, pageId: pageIds.get(evidence.pageNumber), evidenceHash, pageNumber: evidence.pageNumber, printedPageLabel: evidence.printedPageLabel, statement: evidence.statement, tableName: evidence.table, rowLabel: evidence.rowLabel, columnLabel: evidence.columnLabel, rawValue: evidence.rawValue, snippet: evidence.snippet, snippetHash: evidence.snippetHash, locatorHash: evidence.locatorHash, rowIndex: evidence.rowIndex, columnIndex: evidence.columnIndex }, update: {} });
        await tx.p0AFactAssertionEvidence.upsert({ where: { assertionId_evidenceId: { assertionId: assertion.id, evidenceId: stored.id } }, create: { assertionId: assertion.id, evidenceId: stored.id, ordinal }, update: {} });
      }
    }

    const resultIds = new Map<string, string>();
    for (const outcome of input.result.outcomes.filter((item) => item.family === "CALCULATED" && ["VALUE", "ZERO"].includes(item.state))) {
      const formula = PHASE6A_FORMULA_BY_CODE.get(outcome.canonicalCode);
      if (!formula || !outcome.formula || outcome.value === null || !outcome.currency || !outcome.scale || !outcome.factIdentity) throw new Error(`Incomplete calculated identity for ${outcome.requirementId}`);
      const definition = await tx.derivedMetricDefinition.upsert({ where: { code_formulaVersion: { code: formula.code, formulaVersion: formula.formulaVersion } }, create: { code: formula.code, formulaVersion: formula.formulaVersion, expression: formula.expression, namedInputs: json(formula.inputRoles), inclusionRules: json(formula.inclusionRules), exclusionRules: json(formula.exclusionRules), compatibilityRules: json(["same company", "same period", "same scope", "same currency", "same scale"]), outputUnit: outcome.unitType }, update: {} });
      const derived = await tx.derivedMetricResult.upsert({ where: { resultHash: outcome.formula.resultHash }, create: { definitionId: definition.id, runId: run.id, companyId: input.companyId, periodStart: new Date(input.result.context.periodStart), periodEnd: new Date(input.result.context.periodEnd), periodType: input.result.context.periodType, consolidationScope: outcome.scope, currency: outcome.currency, unitType: outcome.unitType, scale: new Prisma.Decimal(outcome.scale), decimalValue: new Prisma.Decimal(outcome.value), calculationTimestamp: new Date(), calculationRunIdentity: outcome.formula.calculationRunIdentity, engine: "InvestAI Decimal Engine", engineVersion: input.result.extractorVersion, validationStatus: "VALIDATED", resultHash: outcome.formula.resultHash }, update: {} });
      resultIds.set(outcome.factIdentity, derived.id);
      for (const [ordinal, metricInput] of outcome.inputs.entries()) {
        const inputAssertionId = assertionIds.get(metricInput.inputId);
        const inputResultId = resultIds.get(metricInput.inputId);
        if ((metricInput.inputId.startsWith("fact:") && !inputAssertionId) || (metricInput.inputId.startsWith("result:") && !inputResultId)) throw new Error(`Unpersisted exact input identity ${metricInput.inputId}`);
        await tx.derivedMetricInput.upsert({ where: { resultId_ordinal: { resultId: derived.id, ordinal } }, create: { resultId: derived.id, ordinal, inputRole: metricInput.inputRole, inputIdentity: metricInput.inputId, inputAssertionId, inputResultId, inputValue: new Prisma.Decimal(metricInput.value), inputExtractionOrigin: metricInput.extractionOrigin, inputEvidenceHashes: json(metricInput.evidence.map((evidence) => evidence.evidenceHash ?? evidence.snippetHash)), revisionContextHash: input.result.runIdentity }, update: {} });
      }
    }

    for (const outcome of input.result.outcomes) await tx.p0BRequirementOutcome.upsert({ where: { runId_requirementId: { runId: run.id, requirementId: outcome.requirementId } }, create: { runId: run.id, requirementId: outcome.requirementId, family: outcome.family, applicability: outcome.applicability, state: outcome.state, reason: outcome.reason, extractionOrigin: outcome.extractionOrigin, reportedAssertionId: outcome.factIdentity ? assertionIds.get(outcome.factIdentity) : undefined, derivedResultId: outcome.factIdentity ? resultIds.get(outcome.factIdentity) : undefined }, update: {} });

    return { runId: run.id, counts: { runs: await tx.p0BExtractionRun.count({ where: { completeIdentityHash: input.result.runIdentity } }), outcomes: await tx.p0BRequirementOutcome.count({ where: { runId: run.id } }), reportedAssertions: await tx.p0BRequirementOutcome.count({ where: { runId: run.id, reportedAssertionId: { not: null } } }), definitions: await tx.derivedMetricDefinition.count(), results: await tx.derivedMetricResult.count({ where: { runId: run.id } }), inputs: await tx.derivedMetricInput.count({ where: { result: { runId: run.id } } }) } };
  }, { timeout: 60_000 });
}
