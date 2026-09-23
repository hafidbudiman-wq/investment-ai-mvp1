import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Prisma } from "@prisma/client";
import { persistP0ACompatibleResult } from "../lib/financial/p0a/ocr-persistence";
import { runP0ACompatiblePipeline } from "../lib/financial/p0a/pipeline";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";
import { persistPhase6A } from "../lib/financial/p0b/persistence";
import { runPhase6A } from "../lib/financial/p0b/phase6a-pipeline";
import { prisma } from "../lib/prisma";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const databaseUrl = process.env.DATABASE_URL ?? "";
let databaseName = "";
try { databaseName = new URL(databaseUrl).pathname.slice(1); } catch { /* fail closed below */ }
if (databaseName !== "investai_phase6a_acceptance") {
  throw new Error("Refusing Phase 6A database acceptance outside investai_phase6a_acceptance.");
}

type Issuer = "ICBP" | "MEDC" | "DRMA";
type Case = {
  ticker: Issuer;
  name: string;
  fileName: string;
  path: string;
  expectedSha: string;
  context: P0AIssuerContext;
  expectedOcr: number[];
  expectedP0A: { numeric: number; notApplicable: number; notDisclosed: number };
};

const cases: Case[] = [
  { ticker: "ICBP", name: "Indofood CBP Sukses Makmur Tbk", fileName: "ICBP_billingual_30Jun25.pdf", path: process.env.P0A_ICBP_PDF_PATH ?? "", expectedSha: "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089", context: { ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "IDR", documentScale: "1000000" }, expectedOcr: [], expectedP0A: { numeric: 28, notApplicable: 1, notDisclosed: 5 } },
  { ticker: "MEDC", name: "Medco Energi Internasional Tbk", fileName: "Lap Keu MEDC 30 juni 2025.pdf", path: process.env.P0A_MEDC_PDF_PATH ?? "", expectedSha: "438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e", context: { ticker: "MEDC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1" }, expectedOcr: [], expectedP0A: { numeric: 27, notApplicable: 1, notDisclosed: 6 } },
  { ticker: "DRMA", name: "Dharma Polimetal Tbk", fileName: "DRMA_2025.pdf", path: process.env.P0A_DRMA_PDF_PATH ?? "", expectedSha: "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb", context: { ticker: "DRMA", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: true, periodStart: "2025-01-01", periodEnd: "2025-12-31", periodType: "FY", currency: "IDR", documentScale: "1" }, expectedOcr: [4, 5, 6, 7], expectedP0A: { numeric: 29, notApplicable: 0, notDisclosed: 5 } },
];

const countModels = {
  Company: () => prisma.company.count(),
  FinancialReport: () => prisma.financialReport.count(),
  FinancialStatement: () => prisma.financialStatement.count(),
  CanonicalAccount: () => prisma.canonicalAccount.count(),
  FinancialEntry: () => prisma.financialEntry.count(),
  ExtractionRun: () => prisma.extractionRun.count(),
  FinancialDocument: () => prisma.financialDocument.count(),
  P0ADocumentPage: () => prisma.p0ADocumentPage.count(),
  P0AExtractionPass: () => prisma.p0AExtractionPass.count(),
  P0AExtractionTask: () => prisma.p0AExtractionTask.count(),
  P0ARequirementOutcome: () => prisma.p0ARequirementOutcome.count(),
  P0AReportRevision: () => prisma.p0AReportRevision.count(),
  P0AFactAssertion: () => prisma.p0AFactAssertion.count(),
  P0AFactEvidence: () => prisma.p0AFactEvidence.count(),
  P0AFactAssertionEvidence: () => prisma.p0AFactAssertionEvidence.count(),
  P0BExtractionRun: () => prisma.p0BExtractionRun.count(),
  P0BRequirementOutcome: () => prisma.p0BRequirementOutcome.count(),
  DerivedMetricDefinition: () => prisma.derivedMetricDefinition.count(),
  DerivedMetricResult: () => prisma.derivedMetricResult.count(),
  DerivedMetricInput: () => prisma.derivedMetricInput.count(),
} as const;

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (child instanceof Date) return child.toISOString();
    if (Buffer.isBuffer(child)) return { byteLength: child.length, sha256: sha(child) };
    if (Prisma.Decimal.isDecimal(child)) return child.toFixed();
    return child;
  });
}

async function semanticFingerprints() {
  const [companies, accounts, entries, reports, statements, extractionRuns] = await Promise.all([
    prisma.company.findMany({ orderBy: { id: "asc" }, omit: { createdAt: true, updatedAt: true } }),
    prisma.canonicalAccount.findMany({ orderBy: { id: "asc" }, omit: { createdAt: true, updatedAt: true } }),
    prisma.financialEntry.findMany({ orderBy: { id: "asc" }, omit: { createdAt: true, updatedAt: true } }),
    prisma.financialReport.findMany({ orderBy: { id: "asc" }, omit: { createdAt: true, updatedAt: true } }),
    prisma.financialStatement.findMany({ orderBy: { id: "asc" }, omit: { createdAt: true, updatedAt: true } }),
    prisma.extractionRun.findMany({ orderBy: { id: "asc" }, omit: { createdAt: true, updatedAt: true } }),
  ]);
  return {
    Company: sha(stable(companies)),
    CanonicalAccount: sha(stable(accounts)),
    FinancialEntry: sha(stable(entries)),
    FinancialReport: sha(stable(reports)),
    FinancialStatement: sha(stable(statements)),
    ExtractionRun: sha(stable(extractionRuns)),
  };
}

async function counts() {
  return Object.fromEntries(await Promise.all(Object.entries(countModels).map(async ([name, count]) => [name, await count()])));
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function snapshot(output: string) {
  const result = { capturedAt: new Date().toISOString(), databaseName, counts: await counts(), semanticFingerprints: await semanticFingerprints() };
  await writeJson(output, result);
  console.log(JSON.stringify(result, null, 2));
}

async function source(item: Case) {
  if (!item.path) throw new Error(`Missing source path for ${item.ticker}`);
  const bytes = await readFile(item.path);
  assert.equal(sha(bytes), item.expectedSha, `${item.ticker} immutable source SHA-256`);
  return bytes;
}

function assertP0A(item: Case, result: Awaited<ReturnType<typeof runP0ACompatiblePipeline>>) {
  const number = (states: string[]) => result.outcomes.filter((outcome) => states.includes(outcome.state)).length;
  assert.equal(result.outcomes.length, 34, `${item.ticker} P0-A requirement count`);
  assert.equal(number(["VALUE", "ZERO"]), item.expectedP0A.numeric, `${item.ticker} P0-A numeric count`);
  assert.equal(number(["NOT_APPLICABLE"]), item.expectedP0A.notApplicable, `${item.ticker} P0-A NOT_APPLICABLE count`);
  assert.equal(number(["NOT_DISCLOSED"]), item.expectedP0A.notDisclosed, `${item.ticker} P0-A NOT_DISCLOSED count`);
  assert.equal(number(["MISSING", "AMBIGUOUS", "CONFLICT"]), 0, `${item.ticker} P0-A unresolved count`);
  assert.equal(result.usage.providerCalls, 0, `${item.ticker} provider calls`);
  assert.deepEqual(result.ocrUsage.ocrPages, item.expectedOcr, `${item.ticker} OCR pages`);
}

async function p0aBaselineRows() {
  const tables = {
    P0ADocumentPage: await prisma.p0ADocumentPage.findMany({ orderBy: { id: "asc" } }),
    P0AExtractionPass: await prisma.p0AExtractionPass.findMany({ orderBy: { id: "asc" } }),
    P0AExtractionTask: await prisma.p0AExtractionTask.findMany({ orderBy: { id: "asc" } }),
    P0ARequirementOutcome: await prisma.p0ARequirementOutcome.findMany({ orderBy: { id: "asc" } }),
    P0AReportRevision: await prisma.p0AReportRevision.findMany({ orderBy: { id: "asc" } }),
    P0AFactAssertion: await prisma.p0AFactAssertion.findMany({ orderBy: { id: "asc" } }),
    P0AFactEvidence: await prisma.p0AFactEvidence.findMany({ orderBy: { id: "asc" } }),
    P0AFactAssertionEvidence: await prisma.p0AFactAssertionEvidence.findMany({ orderBy: [{ assertionId: "asc" }, { evidenceId: "asc" }] }),
  };
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, { ids: rows.map((row) => "id" in row ? row.id : `${row.assertionId}:${row.evidenceId}`), fingerprint: sha(stable(rows)) }]));
}

async function prepare(output: string) {
  const issuerRecords = [];
  for (const item of cases) {
    const bytes = await source(item);
    const company = await prisma.company.upsert({ where: { ticker: item.ticker }, create: { ticker: item.ticker, name: item.name, currency: item.context.currency }, update: {} });
    const objectKey = `phase6a/${item.ticker}/${item.expectedSha}.pdf`;
    const document = await prisma.financialDocument.upsert({
      where: { objectKey },
      create: { storageProvider: "github-actions-ephemeral", bucket: "phase6a-acceptance", objectKey, originalFileName: item.fileName, mimeType: "application/pdf", verifiedSize: bytes.length, sha256: item.expectedSha, content: bytes, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() },
      update: {},
    });
    const p0a = await runP0ACompatiblePipeline({ bytes, context: item.context });
    assertP0A(item, p0a);
    const persisted = await persistP0ACompatibleResult(prisma, { documentId: document.id, companyId: company.id, context: item.context, result: p0a });
    const revision = await prisma.p0AReportRevision.findUniqueOrThrow({ where: { passId: persisted.passId } });
    issuerRecords.push({ ticker: item.ticker, companyId: company.id, documentId: document.id, reportRevisionId: revision.id, p0aOutcomeFingerprint: sha(stable(p0a.outcomes.map((outcome) => ({ requirementId: outcome.requirementId, state: outcome.state, value: outcome.reportedObservation?.decimalValue ?? null })))), ocrPages: p0a.ocrUsage.ocrPages });
  }
  const baseline = { capturedAt: new Date().toISOString(), counts: await counts(), legacyFingerprints: await semanticFingerprints(), p0aTables: await p0aBaselineRows(), issuers: issuerRecords };
  await writeJson(output, baseline);
  console.log(JSON.stringify(baseline, null, 2));
}

function assertSemanticClosure(item: Case, phase6a: Awaited<ReturnType<typeof runPhase6A>>) {
  const outcome = (code: string) => phase6a.outcomes.find((value) => value.canonicalCode === code)!;
  assert.equal(outcome("SHARES_OUTSTANDING_REPORTED").state, "NOT_DISCLOSED", `${item.ticker} shares semantic closure`);
  if (item.ticker === "MEDC") {
    assert.equal(outcome("OCI_TOTAL_REPORTED").state, "VALUE", "MEDC OCI reported state");
    assert.equal(outcome("OCI_TOTAL_REPORTED").value, "-25292786", "MEDC OCI reported value");
    assert.equal(outcome("OCI_TOTAL_REPORTED").currency, "USD", "MEDC OCI currency");
    assert.equal(outcome("OCI_TOTAL_REPORTED").family, "REPORTED", "MEDC OCI family");
    assert.ok(outcome("OCI_TOTAL_REPORTED").evidence.length > 0, "MEDC OCI evidence");
  }
  assert.equal(phase6a.outcomes.filter((value) => ["MISSING", "AMBIGUOUS", "CONFLICT"].includes(value.state)).length, 0, `${item.ticker} Phase 6A unresolved`);
  assert.deepEqual(phase6a.p0a.ocrPages, item.expectedOcr, `${item.ticker} Phase 6A OCR`);
  assert.equal(phase6a.providerUsage.providerCalls, 0, `${item.ticker} Phase 6A provider calls`);
}

async function persist(ticker: Issuer, label: string, output: string) {
  const item = cases.find((value) => value.ticker === ticker)!;
  const bytes = await source(item);
  const company = await prisma.company.findUniqueOrThrow({ where: { ticker } });
  const document = await prisma.financialDocument.findUniqueOrThrow({ where: { objectKey: `phase6a/${ticker}/${item.expectedSha}.pdf` } });
  const revision = await prisma.p0AReportRevision.findFirstOrThrow({ where: { companyId: company.id, documentId: document.id } });
  const p0a = await runP0ACompatiblePipeline({ bytes, context: item.context });
  assertP0A(item, p0a);
  const phase6a = await runPhase6A({ bytes, context: item.context, p0aResult: p0a });
  assertSemanticClosure(item, phase6a);
  const persisted = await persistPhase6A(prisma, { documentId: document.id, companyId: company.id, reportRevisionId: revision.id, result: phase6a });
  const result = { label, ticker, runIdentity: phase6a.runIdentity, runId: persisted.runId, persistenceCounts: persisted.counts, p0aOutcomeFingerprint: phase6a.p0a.outcomeFingerprint, ocrPages: phase6a.p0a.ocrPages, providerUsage: phase6a.providerUsage, outcomes: phase6a.outcomes.map((value) => ({ requirementId: value.requirementId, family: value.family, state: value.state, value: value.value, currency: value.currency, factIdentity: value.factIdentity, formulaId: value.formula?.formulaId ?? null, formulaVersion: value.formula?.formulaVersion ?? null, resultHash: value.formula?.resultHash ?? null })) };
  await writeJson(output, result);
  console.log(JSON.stringify(result, null, 2));
}

async function currentP0ABaselineProjection(baseline: Record<string, { ids: string[]; fingerprint: string }>) {
  const id = (name: string) => baseline[name].ids;
  const pairIds = id("P0AFactAssertionEvidence").map((value) => { const [assertionId, evidenceId] = value.split(":"); return { assertionId, evidenceId }; });
  const tables = {
    P0ADocumentPage: await prisma.p0ADocumentPage.findMany({ where: { id: { in: id("P0ADocumentPage") } }, orderBy: { id: "asc" } }),
    P0AExtractionPass: await prisma.p0AExtractionPass.findMany({ where: { id: { in: id("P0AExtractionPass") } }, orderBy: { id: "asc" } }),
    P0AExtractionTask: await prisma.p0AExtractionTask.findMany({ where: { id: { in: id("P0AExtractionTask") } }, orderBy: { id: "asc" } }),
    P0ARequirementOutcome: await prisma.p0ARequirementOutcome.findMany({ where: { id: { in: id("P0ARequirementOutcome") } }, orderBy: { id: "asc" } }),
    P0AReportRevision: await prisma.p0AReportRevision.findMany({ where: { id: { in: id("P0AReportRevision") } }, orderBy: { id: "asc" } }),
    P0AFactAssertion: await prisma.p0AFactAssertion.findMany({ where: { id: { in: id("P0AFactAssertion") } }, orderBy: { id: "asc" } }),
    P0AFactEvidence: await prisma.p0AFactEvidence.findMany({ where: { id: { in: id("P0AFactEvidence") } }, orderBy: { id: "asc" } }),
    P0AFactAssertionEvidence: await prisma.p0AFactAssertionEvidence.findMany({ where: { OR: pairIds }, orderBy: [{ assertionId: "asc" }, { evidenceId: "asc" }] }),
  };
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, { rowCount: rows.length, fingerprint: sha(stable(rows)) }]));
}

async function verify(baselinePath: string, seedOnePath: string, seedTwoPath: string, firstPath: string, secondPath: string, output: string) {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const seedOne = JSON.parse(await readFile(seedOnePath, "utf8"));
  const seedTwo = JSON.parse(await readFile(seedTwoPath, "utf8"));
  const first = JSON.parse(await readFile(firstPath, "utf8"));
  const second = JSON.parse(await readFile(secondPath, "utf8"));

  assert.deepEqual(seedTwo.counts, seedOne.counts, "Second seed must not change row counts");
  assert.deepEqual(seedTwo.semanticFingerprints, seedOne.semanticFingerprints, "Second seed must be semantically idempotent");
  assert.deepEqual(second.counts, first.counts, "Second Phase 6A persistence must not change row counts");
  const legacyAfter = await semanticFingerprints();
  assert.deepEqual(legacyAfter, baseline.legacyFingerprints, "Legacy/canonical semantic fingerprints must remain unchanged after P0-B persistence");
  const p0aAfter = await currentP0ABaselineProjection(baseline.p0aTables);
  for (const [name, expected] of Object.entries(baseline.p0aTables) as Array<[string, { ids: string[]; fingerprint: string }]>) {
    assert.equal(p0aAfter[name].rowCount, expected.ids.length, `${name} baseline row count`);
    assert.equal(p0aAfter[name].fingerprint, expected.fingerprint, `${name} baseline fingerprint`);
  }

  const duplicateChecks = await prisma.$queryRaw<Array<{ check: string; duplicates: bigint }>>(Prisma.sql`
    SELECT 'P0BExtractionRun.completeIdentityHash' AS check, COUNT(*)::bigint AS duplicates FROM (SELECT "completeIdentityHash" FROM "P0BExtractionRun" GROUP BY 1 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'P0BRequirementOutcome.run_requirement', COUNT(*)::bigint FROM (SELECT "runId", "requirementId" FROM "P0BRequirementOutcome" GROUP BY 1,2 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'DerivedMetricDefinition.code_version', COUNT(*)::bigint FROM (SELECT "code", "formulaVersion" FROM "DerivedMetricDefinition" GROUP BY 1,2 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'DerivedMetricResult.resultHash', COUNT(*)::bigint FROM (SELECT "resultHash" FROM "DerivedMetricResult" GROUP BY 1 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'DerivedMetricInput.result_ordinal', COUNT(*)::bigint FROM (SELECT "resultId", "ordinal" FROM "DerivedMetricInput" GROUP BY 1,2 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'P0AFactAssertion.assertionKey', COUNT(*)::bigint FROM (SELECT "assertionKey" FROM "P0AFactAssertion" GROUP BY 1 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'P0AFactEvidence.evidenceHash', COUNT(*)::bigint FROM (SELECT "evidenceHash" FROM "P0AFactEvidence" GROUP BY 1 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'P0AFactAssertionEvidence.link', COUNT(*)::bigint FROM (SELECT "assertionId", "evidenceId" FROM "P0AFactAssertionEvidence" GROUP BY 1,2 HAVING COUNT(*) > 1) q
  `);
  assert.ok(duplicateChecks.every((row) => row.duplicates === BigInt(0)), "No logical duplicates");

  const linkage = await prisma.$queryRaw<Array<{ invalid_family_targets: bigint; missing_numeric_targets: bigint; empty_input_targets: bigint }>>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE ("family" = 'REPORTED' AND "derivedResultId" IS NOT NULL) OR ("family" = 'CALCULATED' AND "reportedAssertionId" IS NOT NULL))::bigint AS invalid_family_targets,
      COUNT(*) FILTER (WHERE "state" IN ('VALUE','ZERO') AND (("family" = 'REPORTED' AND "reportedAssertionId" IS NULL) OR ("family" = 'CALCULATED' AND "derivedResultId" IS NULL)))::bigint AS missing_numeric_targets,
      (SELECT COUNT(*)::bigint FROM "DerivedMetricInput" WHERE ("inputAssertionId" IS NULL AND "inputResultId" IS NULL) OR ("inputAssertionId" IS NOT NULL AND "inputResultId" IS NOT NULL)) AS empty_input_targets
    FROM "P0BRequirementOutcome"
  `);
  assert.equal(linkage[0].invalid_family_targets, BigInt(0), "Reported/calculated targets remain separate");
  assert.equal(linkage[0].missing_numeric_targets, BigInt(0), "Every numeric outcome has its typed target");
  assert.equal(linkage[0].empty_input_targets, BigInt(0), "Every derived input has exactly one stored target");

  const derived = await prisma.derivedMetricResult.findMany({ include: { definition: true, inputs: { orderBy: { ordinal: "asc" } } }, orderBy: { resultHash: "asc" } });
  for (const result of derived) {
    const recalculated = result.inputs.reduce((sum, input) => sum.plus(input.inputValue), new Prisma.Decimal(0));
    assert.ok(recalculated.equals(result.decimalValue), `${result.definition.code} exact input reproducibility`);
    assert.ok(result.inputs.length > 0, `${result.definition.code} input lineage`);
    assert.ok(result.inputs.every((input) => input.inputIdentity.startsWith("fact:") || input.inputIdentity.startsWith("result:")), `${result.definition.code} canonical input identities`);
  }

  assert.equal(await prisma.p0BExtractionRun.count(), 3, "One immutable P0-B run per issuer");
  assert.equal(await prisma.p0BRequirementOutcome.count(), 54, "18 outcomes per issuer");
  const closure = await prisma.p0BRequirementOutcome.findMany({
    where: { requirementId: { in: ["SHARES_OUTSTANDING_REPORTED", "OCI_TOTAL_REPORTED"] } },
    include: { run: { include: { company: true } }, reportedAssertion: true },
    orderBy: [{ run: { company: { ticker: "asc" } } }, { requirementId: "asc" }],
  });
  for (const ticker of ["ICBP", "MEDC", "DRMA"]) {
    const shares = closure.find((row) => row.run.company.ticker === ticker && row.requirementId === "SHARES_OUTSTANDING_REPORTED")!;
    assert.equal(shares.state, "NOT_DISCLOSED", `${ticker} final shares state`);
    assert.equal(shares.reportedAssertionId, null, `${ticker} shares must not be inferred`);
  }
  const medcOci = closure.find((row) => row.run.company.ticker === "MEDC" && row.requirementId === "OCI_TOTAL_REPORTED")!;
  assert.equal(medcOci.state, "VALUE", "MEDC OCI final state");
  assert.equal(medcOci.reportedAssertion?.decimalValue?.toFixed(), "-25292786", "MEDC OCI reported value persisted");
  assert.equal(medcOci.reportedAssertion?.origin, "REPORTED", "MEDC OCI reported origin persisted");

  const report = {
    acceptanceVersion: "PHASE6A.2_DATABASE_ACCEPTANCE_V1",
    database: { name: databaseName, engine: "PostgreSQL", disposable: true },
    counts: { beforeP0B: baseline.counts, firstPersistence: first.counts, secondPersistence: second.counts },
    seedIdempotency: { passed: true, first: seedOne.counts, second: seedTwo.counts },
    persistenceIdempotency: { passed: true, duplicateChecks: duplicateChecks.map((row) => ({ check: row.check, duplicates: row.duplicates.toString() })) },
    legacyFingerprints: { before: baseline.legacyFingerprints, after: legacyAfter, passed: true },
    p0aFingerprints: { before: Object.fromEntries(Object.entries(baseline.p0aTables).map(([name, value]) => [name, (value as { fingerprint: string }).fingerprint])), after: Object.fromEntries(Object.entries(p0aAfter).map(([name, value]) => [name, value.fingerprint])), passed: true },
    derivedMetrics: { definitions: await prisma.derivedMetricDefinition.count(), results: derived.length, inputs: await prisma.derivedMetricInput.count(), reproducible: true },
    reportedCalculatedLinkage: { ...Object.fromEntries(Object.entries(linkage[0]).map(([key, value]) => [key, value.toString()])), passed: true },
    semanticClosure: { ICBP_SHARES_OUTSTANDING_REPORTED: "NOT_DISCLOSED", MEDC_SHARES_OUTSTANDING_REPORTED: "NOT_DISCLOSED", MEDC_OCI_TOTAL_REPORTED: { state: "VALUE", value: "-25292786", currency: "USD", origin: "REPORTED" }, DRMA_SHARES_OUTSTANDING_REPORTED: "NOT_DISCLOSED" },
    openAi: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: "0.00000000" },
  };
  await writeJson(output, report);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "snapshot" && args[0]) return snapshot(args[0]);
  if (command === "prepare" && args[0]) return prepare(args[0]);
  if (command === "persist" && args[0] && args[1] && args[2]) return persist(args[0] as Issuer, args[1], args[2]);
  if (command === "verify" && args.length === 6) return verify(args[0], args[1], args[2], args[3], args[4], args[5]);
  throw new Error(`Usage: ${basename(process.argv[1])} snapshot <output> | prepare <output> | persist <ICBP|MEDC|DRMA> <label> <output> | verify <baseline> <seed1> <seed2> <first> <second> <output>`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
