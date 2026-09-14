import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { readExtractionQa } from "../lib/financial/p0a/compatibility-read";
import { loadCachedP0ACompatiblePageIndex, persistP0ACompatibleResult } from "../lib/financial/p0a/ocr-persistence";
import { runP0ACompatiblePipeline } from "../lib/financial/p0a/pipeline";
import { createRoutingSnapshot } from "../lib/financial/p0a/routing-snapshot";
import { P0A_PARSER_VERSION } from "../lib/financial/p0a/versions";
import { prisma } from "../lib/prisma";

const EXPECTED_SHA = "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb";
const EXPECTED_PAGES = 106;
const EXPECTED_COUNTS = { valueZero: 29, notApplicable: 0, notDisclosed: 5, missing: 0, ambiguous: 0, conflict: 0 } as const;
const pdfPath = process.env.P0A_DRMA_PDF_PATH ?? "";
const outputDir = process.env.P0A_PHASE5_OUTPUT_DIR ?? "artifacts/phase5";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!pdfPath) throw new Error("P0A_DRMA_PDF_PATH is required.");
let databaseName = "";
try { databaseName = new URL(databaseUrl).pathname.slice(1); } catch { /* rejected below */ }
if (!/p0a_phase5/i.test(databaseName)) throw new Error("Refusing Phase 5C acceptance outside an isolated database whose name contains p0a_phase5.");

const context = {
  ticker: "DRMA", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL",
  consolidated: true, audited: true, periodStart: "2025-01-01", periodEnd: "2025-12-31",
  periodType: "FY", currency: "IDR", documentScale: "1",
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
  const statement = await prisma.financialStatement.create({ data: { reportId: report.id, statementType: "OTHER", currency: "IDR" } });
  const account = await prisma.canonicalAccount.create({ data: { code: "P0A_PHASE5C_LEGACY_SENTINEL", name: "Phase 5C legacy mutation sentinel", statementType: "OTHER" } });
  await prisma.financialEntry.create({ data: { reportId: report.id, statementId: statement.id, canonicalAccountId: account.id, value: new Prisma.Decimal("123"), originalValue: new Prisma.Decimal("123"), scale: 1, currency: "IDR", rawText: "must remain unchanged", reviewStatus: "VERIFIED" } });
  await prisma.extractionRun.create({ data: { companyId, fileName: "legacy-phase5c-sentinel.pdf", fileSize: 1, checksum: "e".repeat(64), status: "UPLOADED" } });
}

function stableRead(read: NonNullable<Awaited<ReturnType<typeof readExtractionQa>>>) {
  return { summary: { ...read.summary, nativeLatencyMs: 0 }, versions: read.versions, facts: read.facts };
}

function decimalOutcome(result: Awaited<ReturnType<typeof runP0ACompatiblePipeline>>, id: string): Prisma.Decimal | null {
  const value = result.outcomes.find((outcome) => outcome.requirementId === id)?.reportedObservation?.decimalValue;
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

async function main() {
  assert.equal(await prisma.p0AExtractionPass.count(), 0, "Phase 5C DRMA DB must start without P0-A passes.");
  const bytes = await readFile(pdfPath);
  const actualSha = hash(bytes);
  assert.equal(actualSha, EXPECTED_SHA, "DRMA source SHA-256");

  const company = await prisma.company.create({ data: { ticker: "DRMA", name: "PT Dharma Polimetal Tbk", currency: "IDR" } });
  await seedLegacySentinel(company.id);
  const document = await prisma.financialDocument.create({
    data: { storageProvider: "isolated-shadow", bucket: "p0a-phase5c", objectKey: `phase5c/drma/${EXPECTED_SHA}.pdf`, originalFileName: "DRMA_2025.pdf", mimeType: "application/pdf", verifiedSize: bytes.length, sha256: actualSha, content: bytes, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() },
  });
  const legacyBefore = await legacySnapshot();

  const firstResult = await runP0ACompatiblePipeline({ bytes, context });
  assert.equal(firstResult.routedPages.length, EXPECTED_PAGES, "DRMA page count");
  assert.equal(firstResult.outcomes.length, 34, "DRMA must retain frozen 34 requirements");
  assert.equal(firstResult.usage.providerCalls, 0, "DRMA Phase 5C must not call a provider");
  assert.deepEqual(firstResult.ocrUsage.ocrPages, [4, 5, 6, 7], "Only the scanned primary-statement corridor may require OCR for this source.");
  const stateCounts = {
    valueZero: firstResult.outcomes.filter((item) => item.state === "VALUE" || item.state === "ZERO").length,
    notApplicable: firstResult.outcomes.filter((item) => item.state === "NOT_APPLICABLE").length,
    notDisclosed: firstResult.outcomes.filter((item) => item.state === "NOT_DISCLOSED").length,
    missing: firstResult.outcomes.filter((item) => item.state === "MISSING").length,
    ambiguous: firstResult.outcomes.filter((item) => item.state === "AMBIGUOUS").length,
    conflict: firstResult.outcomes.filter((item) => item.state === "CONFLICT").length,
  };
  assert.deepEqual(stateCounts, EXPECTED_COUNTS, "DRMA semantic gate drifted");

  const firstPersisted = await persistP0ACompatibleResult(prisma, { documentId: document.id, companyId: company.id, context, result: firstResult });
  const firstRead = await readExtractionQa(prisma, { passId: firstPersisted.passId });
  assert.ok(firstRead);
  assert.equal(firstRead.facts.length, 34);
  assert.equal(firstRead.summary.providerCalls, 0);
  const firstCounts = await shadowCounts(document.id, firstPersisted.passId);

  const cached = await loadCachedP0ACompatiblePageIndex(prisma, document.id, P0A_PARSER_VERSION);
  assert.ok(cached && cached.length === EXPECTED_PAGES, "Second DRMA run must reuse cached compatible pages.");
  assert.deepEqual(cached.filter((page) => page.sourceType === "OCR").map((page) => page.pageNumber), [4, 5, 6, 7], "Cached OCR page identities drifted.");
  const secondResult = await runP0ACompatiblePipeline({ bytes, context, indexedPages: cached });
  assert.deepEqual(secondResult.ocrUsage.ocrPages, [], "Cached rerun must not execute OCR again.");
  assert.deepEqual(secondResult.ocrUsage.reusedOcrPages, [4, 5, 6, 7], "Cached rerun must reuse the same OCR pages.");
  assert.deepEqual(createRoutingSnapshot(secondResult.routedPages), createRoutingSnapshot(firstResult.routedPages), "Routing snapshot changed under same complete pass identity.");
  assert.deepEqual(secondResult.selectedPages, firstResult.selectedPages);
  assert.deepEqual(secondResult.outcomes, firstResult.outcomes);
  const secondPersisted = await persistP0ACompatibleResult(prisma, { documentId: document.id, companyId: company.id, context, result: secondResult });
  assert.equal(secondPersisted.passId, firstPersisted.passId, "Same complete identity must reuse immutable pass.");
  const secondRead = await readExtractionQa(prisma, { passId: secondPersisted.passId });
  assert.ok(secondRead);
  assert.deepEqual(stableRead(secondRead), stableRead(firstRead));
  const secondCounts = await shadowCounts(document.id, secondPersisted.passId);
  assert.deepEqual(secondCounts, firstCounts, "Rerun must not duplicate P0-A persistence records.");
  const legacyAfter = await legacySnapshot();
  assert.deepEqual(legacyAfter, legacyBefore, "Legacy canonical truth must remain mutation-free.");

  const revenue = decimalOutcome(firstResult, "REV_REPORTED");
  const cogs = decimalOutcome(firstResult, "COGS_REPORTED");
  const grossProfit = decimalOutcome(firstResult, "GROSS_PROFIT_REPORTED");
  const assets = decimalOutcome(firstResult, "TOTAL_ASSETS_REPORTED");
  const liabilities = decimalOutcome(firstResult, "TOTAL_LIAB_REPORTED");
  const equity = decimalOutcome(firstResult, "EQUITY_REPORTED");
  const ocf = decimalOutcome(firstResult, "OCF_REPORTED");
  const icf = decimalOutcome(firstResult, "ICF_REPORTED");
  const cff = decimalOutcome(firstResult, "CFF_REPORTED");
  const fx = decimalOutcome(firstResult, "FX_EFFECT_CASH_REPORTED");
  const netCash = decimalOutcome(firstResult, "NET_CHANGE_CASH_REPORTED");
  const parentProfit = decimalOutcome(firstResult, "NET_PROFIT_PARENT_REPORTED");
  const weightedShares = decimalOutcome(firstResult, "WEIGHTED_AVG_SHARES_REPORTED");
  const eps = decimalOutcome(firstResult, "EPS_BASIC_REPORTED");

  const controls = {
    balanceSheet: {
      applicable: Boolean(assets && liabilities && equity),
      passed: Boolean(assets && liabilities && equity && assets.equals(liabilities.plus(equity))),
      left: assets?.toFixed() ?? null,
      right: liabilities && equity ? liabilities.plus(equity).toFixed() : null,
    },
    grossProfit: {
      applicable: Boolean(revenue && cogs && grossProfit),
      passed: Boolean(revenue && cogs && grossProfit && revenue.minus(cogs).equals(grossProfit)),
      reported: grossProfit?.toFixed() ?? null,
      calculated: revenue && cogs ? revenue.minus(cogs).toFixed() : null,
    },
    cashFlowBridge: {
      applicable: Boolean(ocf && icf && cff && fx && netCash),
      passed: Boolean(ocf && icf && cff && fx && netCash && ocf.plus(icf).plus(cff).plus(fx).equals(netCash)),
      reported: netCash?.toFixed() ?? null,
      calculated: ocf && icf && cff && fx ? ocf.plus(icf).plus(cff).plus(fx).toFixed() : null,
    },
    epsReconciliation: {
      applicable: Boolean(parentProfit && weightedShares && eps),
      passed: Boolean(parentProfit && weightedShares && eps && parentProfit.div(weightedShares).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).equals(eps)),
      parentEarnings: parentProfit?.toFixed() ?? null,
      weightedAverageShares: weightedShares?.toFixed() ?? null,
      reportedEps: eps?.toFixed() ?? null,
      calculatedUnrounded: parentProfit && weightedShares ? parentProfit.div(weightedShares).toFixed(9) : null,
      comparisonBasis: "Reported whole-IDR EPS compared with half-up rounded parent earnings / weighted-average shares.",
    },
  };
  assert.equal(controls.balanceSheet.passed, true, "DRMA balance-sheet control");
  assert.equal(controls.grossProfit.passed, true, "DRMA gross-profit control");
  assert.equal(controls.cashFlowBridge.passed, true, "DRMA cash-flow bridge");
  assert.equal(controls.epsReconciliation.passed, true, "DRMA EPS reconciliation");

  const outcomeById = new Map(firstResult.outcomes.map((outcome) => [outcome.requirementId, outcome]));
  const routeByPage = new Map(firstResult.routedPages.map((page) => [page.pageNumber, page]));
  const routingSnapshot = createRoutingSnapshot(firstResult.routedPages);
  const artifact = {
    artifactVersion: "INVESTAI_PHASE5C_DRMA_P0A_ACTUAL_V1",
    sourceVerification: {
      fileName: "DRMA_2025.pdf", sha256: actualSha, pageCount: firstResult.routedPages.length,
      issuer: "PT Dharma Polimetal Tbk", periodStart: context.periodStart, periodEnd: context.periodEnd,
      periodType: context.periodType, scope: "CONSOLIDATED", auditStatus: "AUDITED", currency: context.currency, unit: "DOCUMENT_CURRENCY", scale: context.documentScale,
    },
    summary: { ...firstRead.summary, stateCounts },
    versions: firstRead.versions,
    passIdentity: { passId: firstPersisted.passId, contextHash: firstResult.contextHash, documentSha256: firstResult.documentSha256, versions: firstResult.versions },
    routing: { selectedPages: firstResult.selectedPages, routingSnapshot },
    ocr: {
      firstRun: firstResult.ocrUsage,
      secondRun: secondResult.ocrUsage,
      pageCount: firstResult.ocrUsage.ocrPages.length,
      pages: firstResult.routedPages.filter((page) => page.sourceType === "OCR").map((page) => ({ pageNumber: page.pageNumber, contentClass: page.contentClass, textHash: page.textHash, layoutHash: page.layoutHash, metadata: page.sourceMetadata })),
    },
    providerUsage: firstResult.usage,
    controls,
    idempotency: { passIdStable: true, routingSnapshotStable: true, ocrCacheReused: true, before: firstCounts, after: secondCounts },
    legacyMutationProof: { before: legacyBefore, after: legacyAfter, unchanged: true },
    outcomes: firstRead.facts.map((fact) => {
      const outcome = outcomeById.get(fact.requirementId);
      const sourcePage = fact.sourcePage === null ? null : routeByPage.get(fact.sourcePage) ?? null;
      return {
        requirementId: fact.requirementId,
        canonicalCode: fact.code,
        definition: fact.definition,
        applicability: outcome?.applicability ?? null,
        state: fact.state,
        value: fact.value,
        rawValue: fact.rawValue,
        currency: fact.currency,
        unit: fact.unitType,
        scale: fact.scale,
        period: fact.period,
        scope: fact.period.consolidationScope,
        origin: fact.origin,
        inputOrigin: sourcePage?.sourceType ?? null,
        pdfSourcePage: fact.sourcePage,
        ocrEngine: sourcePage?.sourceType === "OCR" ? sourcePage.sourceMetadata?.engine ?? null : null,
        ocrEngineVersion: sourcePage?.sourceType === "OCR" ? sourcePage.sourceMetadata?.engineVersion ?? null : null,
        pageImageHash: sourcePage?.sourceType === "OCR" ? sourcePage.sourceMetadata?.pageImageHash ?? null : null,
        ocrTextHash: sourcePage?.sourceType === "OCR" ? sourcePage.sourceMetadata?.ocrTextHash ?? null : null,
        rowLabel: fact.evidence[0]?.rowLabel ?? null,
        columnLabel: fact.evidence[0]?.columnLabel ?? null,
        rawEvidenceText: fact.evidence[0]?.snippet ?? null,
        evidenceHashes: fact.evidence.map((item) => ({ evidenceHash: item.evidenceHash, snippetHash: item.snippetHash, locatorHash: item.locatorHash })),
        confidence: { read: fact.readConfidence, mapping: fact.mappingConfidence },
        lineage: fact.lineage,
        attemptedRoutes: outcome?.attemptedRoutes ?? [],
        attemptedPages: outcome?.attemptedPages ?? [],
        legacyComparison: { state: fact.legacyComparison, reason: fact.legacyComparisonReason, value: fact.legacyValue },
      };
    }),
  };

  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, "DRMA-PHASE5-P0A-ACTUAL.json");
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(outputPath, serialized, "utf8");
  const artifactSha = hash(serialized);
  console.log(`PHASE5C_DRMA_SELECTED_PAGES=${JSON.stringify(firstResult.selectedPages)}`);
  console.log(`PHASE5C_DRMA_STATE_COUNTS=${JSON.stringify(stateCounts)}`);
  console.log(`PHASE5C_DRMA_OCR_FIRST=${JSON.stringify(firstResult.ocrUsage.ocrPages)}`);
  console.log(`PHASE5C_DRMA_OCR_REUSED=${JSON.stringify(secondResult.ocrUsage.reusedOcrPages)}`);
  console.log(`PHASE5C_DRMA_ARTIFACT=${outputPath}`);
  console.log(`PHASE5C_DRMA_ARTIFACT_SHA256=${artifactSha}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
