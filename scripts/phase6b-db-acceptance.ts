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
import { persistPhase6B } from "../lib/financial/p0b/phase6b-persistence";
import { readPhase6B } from "../lib/financial/p0b/phase6b-read";
import { runPhase6B } from "../lib/financial/p0b/phase6b-pipeline";
import { prisma } from "../lib/prisma";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const databaseUrl = process.env.DATABASE_URL ?? "";
let databaseName = "";
try { databaseName = new URL(databaseUrl).pathname.slice(1); } catch { /* fail closed below */ }
if (databaseName !== "investai_phase6b_acceptance") throw new Error("Refusing Phase 6B database acceptance outside investai_phase6b_acceptance.");

type Issuer = "ICBP" | "MEDC" | "DRMA";
type Case = { ticker: Issuer; name: string; fileName: string; path: string; expectedSha: string; context: P0AIssuerContext; expectedOcr: number[]; expected: { segments: number; facts: number } };
const cases: Case[] = [
  { ticker: "ICBP", name: "Indofood CBP Sukses Makmur Tbk", fileName: "ICBP_billingual_30Jun25.pdf", path: process.env.P0A_ICBP_PDF_PATH ?? "", expectedSha: "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089", context: { ticker: "ICBP", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "IDR", documentScale: "1000000" }, expectedOcr: [], expected: { segments: 8, facts: 32 } },
  { ticker: "MEDC", name: "Medco Energi Internasional Tbk", fileName: "MEDC_1H25.pdf", path: process.env.P0A_MEDC_PDF_PATH ?? "", expectedSha: "438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e", context: { ticker: "MEDC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1" }, expectedOcr: [], expected: { segments: 8, facts: 24 } },
  { ticker: "DRMA", name: "Dharma Polimetal Tbk", fileName: "DRMA_Q4_2025.pdf", path: process.env.P0A_DRMA_PDF_PATH ?? "", expectedSha: "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb", context: { ticker: "DRMA", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: true, periodStart: "2025-01-01", periodEnd: "2025-12-31", periodType: "FY", currency: "IDR", documentScale: "1" }, expectedOcr: [4, 5, 6, 7], expected: { segments: 4, facts: 4 } },
];

const countModels = {
  Company: () => prisma.company.count(), CanonicalAccount: () => prisma.canonicalAccount.count(), FinancialEntry: () => prisma.financialEntry.count(), FinancialDocument: () => prisma.financialDocument.count(),
  P0AExtractionPass: () => prisma.p0AExtractionPass.count(), P0ARequirementOutcome: () => prisma.p0ARequirementOutcome.count(), P0AFactAssertion: () => prisma.p0AFactAssertion.count(), P0AFactEvidence: () => prisma.p0AFactEvidence.count(),
  P0BExtractionRun: () => prisma.p0BExtractionRun.count(), P0BRequirementOutcome: () => prisma.p0BRequirementOutcome.count(), DerivedMetricResult: () => prisma.derivedMetricResult.count(),
  Phase6BExtractionRun: () => prisma.phase6BExtractionRun.count(), Phase6BRequirementOutcome: () => prisma.phase6BRequirementOutcome.count(), DividendEvent: () => prisma.dividendEvent.count(), DividendEventEvidence: () => prisma.dividendEventEvidence.count(), SegmentDimension: () => prisma.segmentDimension.count(), SegmentIdentityEvidence: () => prisma.segmentIdentityEvidence.count(), SegmentFact: () => prisma.segmentFact.count(), SegmentFactEvidence: () => prisma.segmentFactEvidence.count(),
} as const;

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (child instanceof Date) return child.toISOString();
    if (Buffer.isBuffer(child)) return { byteLength: child.length, sha256: sha(child) };
    if (Prisma.Decimal.isDecimal(child)) return child.toFixed();
    return child;
  });
}
async function counts() { return Object.fromEntries(await Promise.all(Object.entries(countModels).map(async ([name, count]) => [name, await count()]))); }
async function writeJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
async function snapshot(output: string) { const result = { capturedAt: new Date().toISOString(), databaseName, counts: await counts() }; await writeJson(output, result); console.log(JSON.stringify(result, null, 2)); }

async function source(item: Case) {
  if (!item.path) throw new Error(`Missing source path for ${item.ticker}`);
  const bytes = await readFile(item.path);
  assert.equal(sha(bytes), item.expectedSha, `${item.ticker} source checksum`);
  return bytes;
}

async function frozenFingerprints(p0aEvidenceIds?: string[]) {
  const evidenceWhere = p0aEvidenceIds ? { id: { in: p0aEvidenceIds } } : {};
  const tables = {
    Company: await prisma.company.findMany({ orderBy: { id: "asc" } }),
    CanonicalAccount: await prisma.canonicalAccount.findMany({ orderBy: { id: "asc" } }),
    FinancialEntry: await prisma.financialEntry.findMany({ orderBy: { id: "asc" } }),
    FinancialDocument: await prisma.financialDocument.findMany({ orderBy: { id: "asc" }, omit: { content: true } }),
    P0ADocumentPage: await prisma.p0ADocumentPage.findMany({ orderBy: { id: "asc" } }),
    P0AExtractionPass: await prisma.p0AExtractionPass.findMany({ orderBy: { id: "asc" } }),
    P0AExtractionTask: await prisma.p0AExtractionTask.findMany({ orderBy: { id: "asc" } }),
    P0ARequirementOutcome: await prisma.p0ARequirementOutcome.findMany({ orderBy: { id: "asc" } }),
    P0AReportRevision: await prisma.p0AReportRevision.findMany({ orderBy: { id: "asc" } }),
    P0AFactAssertion: await prisma.p0AFactAssertion.findMany({ orderBy: { id: "asc" } }),
    P0AFactEvidence: await prisma.p0AFactEvidence.findMany({ where: evidenceWhere, orderBy: { id: "asc" } }),
    P0AFactAssertionEvidence: await prisma.p0AFactAssertionEvidence.findMany({ orderBy: [{ assertionId: "asc" }, { evidenceId: "asc" }] }),
    P0BExtractionRun: await prisma.p0BExtractionRun.findMany({ orderBy: { id: "asc" } }),
    P0BRequirementOutcome: await prisma.p0BRequirementOutcome.findMany({ orderBy: { id: "asc" } }),
    DerivedMetricDefinition: await prisma.derivedMetricDefinition.findMany({ orderBy: { id: "asc" } }),
    DerivedMetricResult: await prisma.derivedMetricResult.findMany({ orderBy: { id: "asc" } }),
    DerivedMetricInput: await prisma.derivedMetricInput.findMany({ orderBy: [{ resultId: "asc" }, { ordinal: "asc" }] }),
  };
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, sha(stable(rows))]));
}

async function prepare(output: string) {
  const issuers = [];
  for (const item of cases) {
    const bytes = await source(item);
    const company = await prisma.company.upsert({ where: { ticker: item.ticker }, create: { ticker: item.ticker, name: item.name, currency: item.context.currency }, update: {} });
    const objectKey = `phase6b/${item.ticker}/${item.expectedSha}.pdf`;
    const document = await prisma.financialDocument.upsert({ where: { objectKey }, create: { storageProvider: "github-actions-ephemeral", bucket: "phase6b-acceptance", objectKey, originalFileName: item.fileName, mimeType: "application/pdf", verifiedSize: bytes.length, sha256: item.expectedSha, content: bytes, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() }, update: {} });
    const p0a = await runP0ACompatiblePipeline({ bytes, context: item.context });
    assert.equal(p0a.outcomes.filter((outcome) => ["MISSING", "AMBIGUOUS", "CONFLICT"].includes(outcome.state)).length, 0);
    assert.deepEqual(p0a.ocrUsage.ocrPages, item.expectedOcr);
    const p0aStored = await persistP0ACompatibleResult(prisma, { documentId: document.id, companyId: company.id, context: item.context, result: p0a });
    const revision = await prisma.p0AReportRevision.findUniqueOrThrow({ where: { passId: p0aStored.passId } });
    const phase6a = await runPhase6A({ bytes, context: item.context, p0aResult: p0a });
    assert.equal(phase6a.outcomes.length, 18);
    assert.equal(phase6a.outcomes.filter((outcome) => ["MISSING", "AMBIGUOUS", "CONFLICT"].includes(outcome.state)).length, 0);
    await persistPhase6A(prisma, { documentId: document.id, companyId: company.id, reportRevisionId: revision.id, result: phase6a });
    issuers.push({ ticker: item.ticker, companyId: company.id, documentId: document.id, reportRevisionId: revision.id, p0aOutcomeFingerprint: phase6a.p0a.outcomeFingerprint, phase6aRunIdentity: phase6a.runIdentity });
  }
  const p0aEvidenceIds = (await prisma.p0AFactEvidence.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id);
  const result = { capturedAt: new Date().toISOString(), counts: await counts(), p0aEvidenceIds, frozenFingerprints: await frozenFingerprints(p0aEvidenceIds), issuers };
  await writeJson(output, result);
  console.log(JSON.stringify(result, null, 2));
}

async function persist(ticker: Issuer, label: string, output: string) {
  const item = cases.find((candidate) => candidate.ticker === ticker)!;
  const bytes = await source(item);
  const company = await prisma.company.findUniqueOrThrow({ where: { ticker } });
  const document = await prisma.financialDocument.findUniqueOrThrow({ where: { objectKey: `phase6b/${ticker}/${item.expectedSha}.pdf` } });
  const revision = await prisma.p0AReportRevision.findFirstOrThrow({ where: { companyId: company.id, documentId: document.id } });
  const p0a = await runP0ACompatiblePipeline({ bytes, context: item.context });
  const result = await runPhase6B({ bytes, context: item.context, p0aResult: p0a });
  assert.deepEqual(result.p0a.ocrPages, item.expectedOcr);
  assert.equal(result.dividendEvents.length, 1);
  assert.equal(result.segmentIdentities.length, item.expected.segments);
  assert.equal(result.segmentFacts.length, item.expected.facts);
  const stored = await persistPhase6B(prisma, { documentId: document.id, companyId: company.id, reportRevisionId: revision.id, result });
  const read = await readPhase6B(prisma, result.runIdentity);
  assert.equal(read?.dividendEvents.length, 1);
  assert.equal(read?.segmentFacts.length, item.expected.facts);
  const record = { label, ticker, runIdentity: result.runIdentity, persistenceCounts: stored.counts, readCounts: { dividendEvents: read?.dividendEvents.length, segmentFacts: read?.segmentFacts.length }, providerUsage: result.providerUsage, ocrPages: result.p0a.ocrPages };
  await writeJson(output, record);
  console.log(JSON.stringify(record, null, 2));
}

async function verify(baselinePath: string, seedOnePath: string, seedTwoPath: string, firstPath: string, secondPath: string, output: string) {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const seedOne = JSON.parse(await readFile(seedOnePath, "utf8"));
  const seedTwo = JSON.parse(await readFile(seedTwoPath, "utf8"));
  const first = JSON.parse(await readFile(firstPath, "utf8"));
  const second = JSON.parse(await readFile(secondPath, "utf8"));
  assert.deepEqual(seedTwo.counts, seedOne.counts, "seed twice row-count idempotency");
  assert.deepEqual(second.counts, first.counts, "Phase 6B second run row-count idempotency");
  assert.deepEqual(await frozenFingerprints(baseline.p0aEvidenceIds), baseline.frozenFingerprints, "legacy, P0-A and Phase 6A fingerprints remain unchanged");

  const duplicateChecks = await prisma.$queryRaw<Array<{ check: string; duplicates: bigint }>>(Prisma.sql`
    SELECT 'Phase6BExtractionRun.identity' AS check, COUNT(*)::bigint AS duplicates FROM (SELECT "completeIdentityHash" FROM "Phase6BExtractionRun" GROUP BY 1 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'Phase6BRequirementOutcome.run_requirement', COUNT(*)::bigint FROM (SELECT "runId", "requirementId" FROM "Phase6BRequirementOutcome" GROUP BY 1,2 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'DividendEvent.eventKey', COUNT(*)::bigint FROM (SELECT "eventKey" FROM "DividendEvent" GROUP BY 1 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'DividendEventEvidence.link', COUNT(*)::bigint FROM (SELECT "eventId", "evidenceId", "fieldName" FROM "DividendEventEvidence" GROUP BY 1,2,3 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'SegmentDimension.identityKey', COUNT(*)::bigint FROM (SELECT "identityKey" FROM "SegmentDimension" GROUP BY 1 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'SegmentIdentityEvidence.link', COUNT(*)::bigint FROM (SELECT "segmentId", "evidenceId" FROM "SegmentIdentityEvidence" GROUP BY 1,2 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'SegmentFact.factKey', COUNT(*)::bigint FROM (SELECT "factKey" FROM "SegmentFact" GROUP BY 1 HAVING COUNT(*) > 1) q
    UNION ALL SELECT 'SegmentFactEvidence.link', COUNT(*)::bigint FROM (SELECT "factId", "evidenceId" FROM "SegmentFactEvidence" GROUP BY 1,2 HAVING COUNT(*) > 1) q
  `);
  assert.ok(duplicateChecks.every((row) => row.duplicates === BigInt(0)));
  assert.equal(await prisma.phase6BExtractionRun.count(), 3);
  assert.equal(await prisma.phase6BRequirementOutcome.count(), 9);
  assert.equal(await prisma.dividendEvent.count(), 3);
  assert.equal(await prisma.segmentDimension.count(), 20);
  assert.equal(await prisma.segmentFact.count(), 60);
  assert.equal(await prisma.segmentFact.count({ where: { metricCode: "OPERATING_PROFIT" } }), 8);
  assert.equal(await prisma.segmentFact.count({ where: { origin: { not: "REPORTED" } } }), 0);
  assert.equal(await prisma.phase6BExtractionRun.count({ where: { providerCalls: { not: 0 } } }), 0);
  const evidenceGaps = await prisma.$queryRaw<Array<{ event_gaps: bigint; segment_gaps: bigint; fact_gaps: bigint }>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "DividendEvent" e WHERE NOT EXISTS (SELECT 1 FROM "DividendEventEvidence" x WHERE x."eventId" = e.id))::bigint AS event_gaps,
      (SELECT COUNT(*) FROM "SegmentDimension" s WHERE NOT EXISTS (SELECT 1 FROM "SegmentIdentityEvidence" x WHERE x."segmentId" = s.id))::bigint AS segment_gaps,
      (SELECT COUNT(*) FROM "SegmentFact" f WHERE NOT EXISTS (SELECT 1 FROM "SegmentFactEvidence" x WHERE x."factId" = f.id))::bigint AS fact_gaps
  `);
  assert.deepEqual(evidenceGaps[0], { event_gaps: BigInt(0), segment_gaps: BigInt(0), fact_gaps: BigInt(0) });

  const report = {
    acceptanceVersion: "PHASE6B_DATABASE_ACCEPTANCE_V1",
    database: { name: databaseName, engine: "PostgreSQL", disposable: true },
    counts: { beforePhase6B: baseline.counts, firstPersistence: first.counts, secondPersistence: second.counts },
    seedIdempotency: { passed: true, first: seedOne.counts, second: seedTwo.counts },
    persistenceIdempotency: { passed: true, duplicateChecks: duplicateChecks.map((row) => ({ check: row.check, duplicates: row.duplicates.toString() })) },
    frozenFingerprints: { before: baseline.frozenFingerprints, after: await frozenFingerprints(baseline.p0aEvidenceIds), passed: true },
    evidenceCompleteness: { eventGaps: "0", segmentGaps: "0", factGaps: "0", passed: true },
    openAi: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: "0.00000000" },
    productionSafety: { disposableOnly: true, railwayMutation: false, deployment: false },
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
