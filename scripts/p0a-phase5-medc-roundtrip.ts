import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { readExtractionQa } from "../lib/financial/p0a/compatibility-read";
import { runP0ANativePipeline } from "../lib/financial/p0a/pipeline";
import { loadCachedP0APageIndex, persistP0AShadowResult } from "../lib/financial/p0a/persistence";
import { createRoutingSnapshot } from "../lib/financial/p0a/routing-snapshot";
import { P0A_PARSER_VERSION } from "../lib/financial/p0a/versions";
import { prisma } from "../lib/prisma";

const EXPECTED_SHA = "438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e";
const EXPECTED_PAGES = 333;
const pdfPath = process.env.P0A_MEDC_PDF_PATH ?? "";
const outputDir = process.env.P0A_PHASE5_OUTPUT_DIR ?? "artifacts/phase5";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!pdfPath) throw new Error("P0A_MEDC_PDF_PATH is required.");
let databaseName = "";
try { databaseName = new URL(databaseUrl).pathname.slice(1); } catch { /* rejected below */ }
if (!/p0a_phase5/i.test(databaseName)) throw new Error("Refusing Phase 5 acceptance outside an isolated database whose name contains p0a_phase5.");

const context = {
  ticker: "MEDC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL",
  consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30",
  periodType: "H1", currency: "USD", documentScale: "1",
} as const;

function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

async function shadowCounts(documentId: string, passId: string) {
  const revision = await prisma.p0AReportRevision.findUniqueOrThrow({ where: { passId } });
  return {
    pages: await prisma.p0ADocumentPage.count({ where: { documentId } }),
    passes: await prisma.p0AExtractionPass.count({ where: { documentId } }),
    tasks: await prisma.p0AExtractionTask.count({ where: { passId } }),
    outcomes: await prisma.p0ARequirementOutcome.count({ where: { passId } }),
    revisions: await prisma.p0AReportRevision.count({ where: { documentId } }),
    assertions: await prisma.p0AFactAssertion.count({ where: { reportRevisionId: revision.id } }),
    evidence: await prisma.p0AFactEvidence.count({ where: { documentId } }),
    assertionEvidence: await prisma.p0AFactAssertionEvidence.count({ where: { assertion: { reportRevisionId: revision.id } } }),
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
    counts: { reports: reports.length, statements: statements.length, accounts: accounts.length, entries: entries.length, runs: runs.length, chunks: chunks.length, candidates: candidates.length },
    fingerprint: hash(JSON.stringify({ reports, statements, accounts, entries, runs, chunks, candidates })),
  };
}

async function seedLegacySentinel(companyId: string) {
  const report = await prisma.financialReport.create({
    data: { companyId, year: 2024, periodType: "FY", periodStart: new Date("2024-01-01T00:00:00.000Z"), periodEnd: new Date("2024-12-31T00:00:00.000Z"), audited: true, consolidated: true, sourceType: "MANUAL", status: "VERIFIED" },
  });
  const statement = await prisma.financialStatement.create({ data: { reportId: report.id, statementType: "OTHER", currency: "USD" } });
  const account = await prisma.canonicalAccount.create({ data: { code: "P0A_PHASE5_LEGACY_SENTINEL", name: "Phase 5 legacy mutation sentinel", statementType: "OTHER" } });
  await prisma.financialEntry.create({ data: { reportId: report.id, statementId: statement.id, canonicalAccountId: account.id, value: new Prisma.Decimal("123"), originalValue: new Prisma.Decimal("123"), scale: 1, currency: "USD", rawText: "must remain unchanged", reviewStatus: "VERIFIED" } });
  await prisma.extractionRun.create({ data: { companyId, fileName: "legacy-phase5-sentinel.pdf", fileSize: 1, checksum: "f".repeat(64), status: "UPLOADED" } });
}

function stableRead(read: NonNullable<Awaited<ReturnType<typeof readExtractionQa>>>) {
  return { summary: { ...read.summary, nativeLatencyMs: 0 }, versions: read.versions, facts: read.facts };
}

async function main() {
  assert.equal(await prisma.p0AExtractionPass.count(), 0, "Phase 5 MEDC DB must start without P0-A passes.");
  const bytes = await readFile(pdfPath);
  const actualSha = hash(bytes);
  assert.equal(actualSha, EXPECTED_SHA, "MEDC source SHA-256");

  const company = await prisma.company.create({ data: { ticker: "MEDC", name: "PT Medco Energi Internasional Tbk", currency: "USD" } });
  await seedLegacySentinel(company.id);
  const document = await prisma.financialDocument.create({
    data: { storageProvider: "isolated-shadow", bucket: "p0a-phase5", objectKey: `phase5/medc/${EXPECTED_SHA}.pdf`, originalFileName: "Lap Keu MEDC 30 juni 2025.pdf", mimeType: "application/pdf", verifiedSize: bytes.length, sha256: actualSha, content: bytes, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() },
  });
  const legacyBefore = await legacySnapshot();

  const firstResult = await runP0ANativePipeline({ bytes, context });
  assert.equal(firstResult.routedPages.length, EXPECTED_PAGES, "MEDC page count");
  assert.match(firstResult.routedPages[0].text, /PT Medco Energi Internasional Tbk/i);
  assert.match(firstResult.routedPages[0].text, /six-month period/i);
  assert.match(firstResult.routedPages[0].text, /unaudited|tidak diaudit/i);
  assert.equal(firstResult.usage.providerCalls, 0);
  assert.equal(firstResult.outcomes.length, 34);

  const firstPersisted = await persistP0AShadowResult(prisma, { documentId: document.id, companyId: company.id, context, result: firstResult });
  const firstRead = await readExtractionQa(prisma, { passId: firstPersisted.passId });
  assert.ok(firstRead);
  assert.equal(firstRead.facts.length, 34);
  assert.equal(firstRead.summary.providerCalls, 0);
  assert.equal(firstRead.summary.shadowOnly, true);
  assert.equal(firstRead.summary.documentPages, EXPECTED_PAGES);
  const firstCounts = await shadowCounts(document.id, firstPersisted.passId);

  const cached = await loadCachedP0APageIndex(prisma, document.id, P0A_PARSER_VERSION);
  assert.ok(cached && cached.length === EXPECTED_PAGES, "Second MEDC run must use cached pages.");
  const secondResult = await runP0ANativePipeline({ bytes, context, indexedPages: cached });
  assert.deepEqual(createRoutingSnapshot(secondResult.routedPages), createRoutingSnapshot(firstResult.routedPages));
  assert.deepEqual(secondResult.selectedPages, firstResult.selectedPages);
  assert.deepEqual(secondResult.outcomes, firstResult.outcomes);
  const secondPersisted = await persistP0AShadowResult(prisma, { documentId: document.id, companyId: company.id, context, result: secondResult });
  assert.equal(secondPersisted.passId, firstPersisted.passId, "Same identity must reuse immutable pass.");
  const secondRead = await readExtractionQa(prisma, { passId: secondPersisted.passId });
  assert.ok(secondRead);
  assert.deepEqual(stableRead(secondRead), stableRead(firstRead));
  const secondCounts = await shadowCounts(document.id, secondPersisted.passId);
  assert.deepEqual(secondCounts, firstCounts, "Rerun must not create duplicate P0-A records.");
  const legacyAfter = await legacySnapshot();
  assert.deepEqual(legacyAfter, legacyBefore, "Legacy canonical truth must be byte-for-byte fingerprint-stable.");

  const outcomeById = new Map(firstResult.outcomes.map((outcome) => [outcome.requirementId, outcome]));
  const routeByPage = new Map(firstResult.routedPages.map((page) => [page.pageNumber, { pageNumber: page.pageNumber, pageClass: page.pageClass, statementType: page.statementType, confidence: page.confidence, matchedAnchors: page.matchedAnchors, textHash: page.textHash, layoutHash: page.layoutHash }]));
  const selectedRouting = firstResult.selectedPages.map((page) => routeByPage.get(page)).filter(Boolean);
  const balanceControl = firstResult.validations.find((check) => check.id === "BALANCE_SHEET_IDENTITY") ?? null;
  const cashControl = firstResult.validations.find((check) => check.id === "CASH_FLOW_BRIDGE") ?? null;

  const artifact = {
    artifactVersion: "INVESTAI_PHASE5_P0A_ACTUAL_V1",
    sourceVerification: {
      fileName: "Lap Keu MEDC 30 juni 2025.pdf", sha256: actualSha, pageCount: firstResult.routedPages.length,
      issuer: "PT Medco Energi Internasional Tbk", periodStart: context.periodStart, periodEnd: context.periodEnd,
      periodType: context.periodType, scope: "CONSOLIDATED", auditStatus: "UNAUDITED", currency: "USD", unit: "DOCUMENT_CURRENCY", scale: "1",
    },
    summary: firstRead.summary,
    versions: firstRead.versions,
    fullVersionIdentity: { ...firstResult.versions, contextHash: firstResult.contextHash, documentSha256: firstResult.documentSha256 },
    routing: { selectedPages: firstResult.selectedPages, selectedRoutingEvidence: selectedRouting },
    providerUsage: { providerCalls: firstResult.usage.providerCalls, inputTokens: firstResult.usage.inputTokens, outputTokens: firstResult.usage.outputTokens, estimatedCostUsd: firstResult.usage.estimatedCostUsd, billedCostUsd: firstResult.usage.billedCostUsd },
    controls: {
      balanceSheet: balanceControl,
      cashFlow: { ...cashControl, forced: false, note: cashControl?.passed ? "P0-A reported bridge reconciles." : "Not forced when the issuer presentation does not report a directly comparable group NET_CHANGE_CASH scalar." },
    },
    idempotency: { passIdStable: true, routingSnapshotStable: true, before: firstCounts, after: secondCounts },
    legacyMutationProof: { before: legacyBefore, after: legacyAfter, unchanged: true },
    facts: firstRead.facts.map((fact) => {
      const outcome = outcomeById.get(fact.requirementId);
      const sourceRouting = fact.sourcePage === null ? null : routeByPage.get(fact.sourcePage) ?? null;
      return {
        requirementId: fact.requirementId,
        canonicalCode: fact.code,
        definition: fact.definition,
        applicability: outcome?.applicability ?? null,
        semanticState: fact.state,
        normalizedValue: fact.value,
        rawValue: fact.rawValue,
        currency: fact.currency,
        unit: fact.unitType,
        scale: fact.scale,
        origin: fact.origin,
        statement: fact.statement,
        reportingPeriod: fact.period,
        consolidationScope: fact.period.consolidationScope,
        sourcePdfPage: fact.sourcePage,
        rowLabel: fact.evidence[0]?.rowLabel ?? null,
        columnLabel: fact.evidence[0]?.columnLabel ?? null,
        sourceSnippet: fact.evidence[0]?.snippet ?? null,
        evidenceHashes: fact.evidence.map((item) => ({ evidenceHash: item.evidenceHash, snippetHash: item.snippetHash, locatorHash: item.locatorHash })),
        confidence: { read: fact.readConfidence, mapping: fact.mappingConfidence },
        lineage: fact.lineage,
        attemptedRoutes: outcome?.attemptedRoutes ?? [],
        attemptedPages: outcome?.attemptedPages ?? [],
        routingEvidence: sourceRouting,
        legacyComparison: { state: fact.legacyComparison, reason: fact.legacyComparisonReason, value: fact.legacyValue },
        source: fact.source,
      };
    }),
  };

  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, "MEDC-PHASE5-P0A-ACTUAL.json");
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(outputPath, serialized, "utf8");
  const artifactSha = hash(serialized);
  console.log(`PHASE5_MEDC_SELECTED_PAGES=${JSON.stringify(firstResult.selectedPages)}`);
  console.log(`PHASE5_MEDC_STATE_COUNTS=${JSON.stringify({ valueZero: firstRead.summary.valueZeroCount, notApplicable: firstRead.summary.notApplicableCount, notDisclosed: firstRead.summary.notDisclosedCount, missing: firstRead.summary.missingCount, ambiguous: firstRead.summary.ambiguousCount, conflict: firstRead.summary.conflictCount })}`);
  console.log(`PHASE5_MEDC_ARTIFACT=${outputPath}`);
  console.log(`PHASE5_MEDC_ARTIFACT_SHA256=${artifactSha}`);
  console.log(`PHASE5_MEDC_ARTIFACT_BASE64=${Buffer.from(serialized, "utf8").toString("base64")}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
