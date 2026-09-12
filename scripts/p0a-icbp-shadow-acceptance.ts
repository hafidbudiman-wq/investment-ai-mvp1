import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createIcbpDeterministicExtractor } from "../lib/financial/p0a/mock-extractor";
import { runP0AShadowJobCycle } from "../lib/financial/p0a/job-worker";
import { runP0AShadowPipeline } from "../lib/financial/p0a/pipeline";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { claimNextJob, markJobRunning, markJobSubmissionUnknown } from "../lib/platform/jobs/job-repository";

const EXPECTED_SHA = "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089";
const pdfPath = process.env.P0A_ICBP_PDF_PATH ?? "";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!pdfPath) throw new Error("P0A_ICBP_PDF_PATH is required.");
let databaseName = "";
try { databaseName = new URL(databaseUrl).pathname.slice(1); } catch { /* rejected below */ }
if (!/p0a_shadow/i.test(databaseName)) throw new Error("Refusing acceptance run outside a database whose name contains p0a_shadow.");

const context = {
  ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL",
  consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30",
  periodType: "H1", currency: "IDR", documentScale: "1000000",
} as const;

async function legacyCounts() {
  return {
    financialReports: await prisma.financialReport.count(),
    financialStatements: await prisma.financialStatement.count(),
    canonicalAccounts: await prisma.canonicalAccount.count(),
    financialEntries: await prisma.financialEntry.count(),
    extractionRuns: await prisma.extractionRun.count(),
    extractionChunks: await prisma.extractionChunk.count(),
    extractionCandidates: await prisma.extractionCandidate.count(),
  };
}

async function legacySentinels() {
  return {
    entries: await prisma.financialEntry.findMany({ select: { id: true, value: true, rawText: true, reviewStatus: true }, orderBy: { id: "asc" } }),
    runs: await prisma.extractionRun.findMany({ select: { id: true, checksum: true, status: true, errorMessage: true }, orderBy: { id: "asc" } }),
  };
}

async function seedLegacySentinel(companyId: string) {
  const report = await prisma.financialReport.create({ data: {
    companyId, year: 2024, periodType: "FY", periodEnd: new Date("2024-12-31"),
    audited: true, consolidated: true, sourceType: "MANUAL", status: "VERIFIED",
  } });
  const statement = await prisma.financialStatement.create({ data: { reportId: report.id, statementType: "OTHER", currency: "IDR" } });
  const account = await prisma.canonicalAccount.create({ data: { code: "P0A_LEGACY_SENTINEL", name: "P0-A legacy mutation sentinel", statementType: "OTHER" } });
  await prisma.financialEntry.create({ data: {
    reportId: report.id, statementId: statement.id, canonicalAccountId: account.id,
    value: new Prisma.Decimal("123"), rawText: "must remain unchanged", reviewStatus: "VERIFIED",
  } });
  await prisma.extractionRun.create({ data: {
    companyId, fileName: "legacy-sentinel.pdf", fileSize: 1, checksum: "a".repeat(64), status: "UPLOADED",
  } });
}

async function enqueue(documentId: string, companyId: string, suffix: string) {
  return prisma.job.create({ data: {
    correlationId: randomUUID(), type: "FINANCIAL_EXTRACT_P0A_SHADOW", status: "QUEUED",
    documentId, deduplicationKey: `p0a-icbp-${suffix}`,
    payload: { companyId, context }, maxAttempts: 3,
  } });
}

async function main() {
  const bytes = await readFile(pdfPath);
  const actualSha = createHash("sha256").update(bytes).digest("hex");
  if (actualSha !== EXPECTED_SHA) throw new Error(`Unexpected ICBP fixture SHA-256: ${actualSha}`);
  const company = await prisma.company.create({ data: { ticker: "ICBP", name: "PT Indofood CBP Sukses Makmur Tbk", currency: "IDR" } });
  await seedLegacySentinel(company.id);
  const document = await prisma.financialDocument.create({ data: {
    storageProvider: "isolated-shadow", bucket: "p0a-shadow", objectKey: `icbp/${EXPECTED_SHA}.pdf`,
    originalFileName: "ICBP_billingual_30Jun25.pdf", mimeType: "application/pdf",
    verifiedSize: bytes.length, sha256: actualSha, content: bytes, magicBytesVerified: true,
    status: "VERIFIED", verifiedAt: new Date(),
  } });
  const before = await legacyCounts();
  const sentinelBefore = await legacySentinels();
  const extractor = createIcbpDeterministicExtractor();
  const nativeAcceptance = await runP0AShadowPipeline({ bytes, context, extractor });
  if (!nativeAcceptance.validations.every((check) => check.passed)) throw new Error("Transient validation checks failed.");

  const legacyGuard = await prisma.job.create({ data: {
    correlationId: randomUUID(), type: "FINANCIAL_EXTRACT", status: "QUEUED", priority: 0,
    documentId: document.id, deduplicationKey: "legacy-path-guard", payload: {},
  } });

  const firstJob = await enqueue(document.id, company.id, "first");
  if (!await runP0AShadowJobCycle("p0a-acceptance-worker-1", extractor)) throw new Error("First shadow job was not claimed.");
  const firstCounts = {
    pages: await prisma.p0ADocumentPage.count(), passes: await prisma.p0AExtractionPass.count(),
    tasks: await prisma.p0AExtractionTask.count(), outcomes: await prisma.p0ARequirementOutcome.count(),
    revisions: await prisma.p0AReportRevision.count(), assertions: await prisma.p0AFactAssertion.count(), evidence: await prisma.p0AFactEvidence.count(),
  };

  const secondJob = await enqueue(document.id, company.id, "second");
  if (!await runP0AShadowJobCycle("p0a-acceptance-worker-2", extractor)) throw new Error("Second shadow job was not claimed.");
  const secondCounts = {
    pages: await prisma.p0ADocumentPage.count(), passes: await prisma.p0AExtractionPass.count(),
    tasks: await prisma.p0AExtractionTask.count(), outcomes: await prisma.p0ARequirementOutcome.count(),
    revisions: await prisma.p0AReportRevision.count(), assertions: await prisma.p0AFactAssertion.count(), evidence: await prisma.p0AFactEvidence.count(),
  };
  const pass = await prisma.p0AExtractionPass.findFirstOrThrow({ include: { tasks: true, outcomes: true } });
  const unknownJob = await enqueue(document.id, company.id, "submission-unknown");
  const unknownClaim = await claimNextJob("p0a-submission-unknown-worker", undefined, "FINANCIAL_EXTRACT_P0A_SHADOW");
  if (!unknownClaim || unknownClaim.jobId !== unknownJob.id) throw new Error("Submission-unknown safety job was not claimed.");
  await markJobRunning(unknownClaim);
  await markJobSubmissionUnknown(unknownClaim, { providerRequestId: "mock-request-id", errorMessage: "Deterministic reconciliation-state test." });
  const reclaimAfterUnknown = await claimNextJob("p0a-reclaim-check", undefined, "FINANCIAL_EXTRACT_P0A_SHADOW");
  const after = await legacyCounts();
  const sentinelAfter = await legacySentinels();
  const selectedPages = pass.selectedPages as number[];
  const expectedPages = [4, 5, 6, 7, 8, 9, 10, 86, 88];
  const gaps = pass.outcomes.filter((item) => ["MISSING", "NOT_DISCLOSED", "AMBIGUOUS", "CONFLICT"].includes(item.state)).map((item) => ({ requirementId: item.requirementId, state: item.state, reason: item.reason }));
  const providerCalls = pass.tasks.reduce((sum, task) => sum + task.providerCalls, 0);
  const result = {
    fixture: { sha256: actualSha, pageCount: firstCounts.pages },
    extractionMode: "DETERMINISTIC_ICBP_FIXTURE",
    jobs: { first: (await prisma.job.findUniqueOrThrow({ where: { id: firstJob.id } })).status, second: (await prisma.job.findUniqueOrThrow({ where: { id: secondJob.id } })).status },
    selectedPages,
    icbpPilotPageCeiling: { limit: 10, passed: selectedPages.length <= 10, scope: "ICBP_PILOT_ONLY" },
    routingAcceptance: { expectedPages, passed: JSON.stringify(selectedPages) === JSON.stringify(expectedPages) },
    outcomes: Object.fromEntries(["VALUE", "ZERO", "NOT_APPLICABLE", "NOT_DISCLOSED", "MISSING"].map((state) => [state, pass.outcomes.filter((item) => item.state === state).length])),
    gaps,
    providerCalls,
    providerMetadata: pass.tasks.map((task) => ({ executionMode: task.executionMode, provider: task.provider, model: task.model, selectedPageCount: task.selectedPageCount, requirementCount: task.requirementCount, documentPageCount: task.documentPageCount, validatedFactCount: task.validatedFactCount, providerRequestId: task.providerRequestId, providerResponseId: task.providerResponseId, retryCount: task.retryCount, inputTokens: task.inputTokens, outputTokens: task.outputTokens, processingLatencyMs: task.processingLatencyMs, estimatedCostUsd: task.estimatedCostUsd, billedCostUsd: task.billedCostUsd, providerCalls: task.providerCalls })),
    idempotency: { firstCounts, secondCounts, stable: JSON.stringify(firstCounts) === JSON.stringify(secondCounts) },
    cache: { pageIndexCacheHitOnSecondRun: pass.pageIndexCacheHit },
    legacyMutationProof: { before, after, sentinelBefore, sentinelAfter, unchanged: JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(sentinelBefore) === JSON.stringify(sentinelAfter) },
    assertions: { persistedReportedOnly: await prisma.p0AFactAssertion.count({ where: { origin: "REPORTED" } }), persistedNonReported: await prisma.p0AFactAssertion.count({ where: { origin: { not: "REPORTED" } } }) },
    transientValidations: nativeAcceptance.validations,
    jobSafety: {
      legacyGuardStatus: (await prisma.job.findUniqueOrThrow({ where: { id: legacyGuard.id } })).status,
      submissionUnknownStatus: (await prisma.job.findUniqueOrThrow({ where: { id: unknownJob.id } })).status,
      submissionUnknownReclaimed: reclaimAfterUnknown !== null,
    },
    shadowSemantics: { realProviderExtractionPassed: false, separateProviderApprovalRequired: true },
  };
  if (providerCalls !== 0 || !result.routingAcceptance.passed || pass.outcomes.length !== 34 || !result.cache.pageIndexCacheHitOnSecondRun || !result.idempotency.stable || !result.legacyMutationProof.unchanged || !result.icbpPilotPageCeiling.passed || result.jobSafety.legacyGuardStatus !== "QUEUED" || result.jobSafety.submissionUnknownStatus !== "SUBMISSION_UNKNOWN" || result.jobSafety.submissionUnknownReclaimed) throw new Error(`Acceptance invariant failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
}

main().finally(() => prisma.$disconnect());
