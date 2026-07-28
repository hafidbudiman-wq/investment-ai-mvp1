import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/pdf-extraction";
import {
  parseFinancialExtractionResponse,
  retrieveFinancialPdfBackground,
  submitFinancialPdfBackground,
} from "@/lib/openai-financial-extraction";

type AsyncJob = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  status: string;
  openAiResponseId: string | null;
  runId: string | null;
  detectedTicker: string | null;
  detectedCompanyName: string | null;
  detectedYear: number | null;
  detectedPeriodType: string | null;
  errorMessage: string | null;
  preflight: unknown;
  fileData?: Buffer | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function ensureAsyncExtractionTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AsyncExtractionJob" (
      "id" TEXT PRIMARY KEY,
      "fileName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
      "fileSize" INTEGER NOT NULL,
      "checksum" TEXT NOT NULL UNIQUE,
      "status" TEXT NOT NULL DEFAULT 'UPLOADED',
      "openAiResponseId" TEXT,
      "runId" TEXT,
      "detectedTicker" TEXT,
      "detectedCompanyName" TEXT,
      "detectedYear" INTEGER,
      "detectedPeriodType" TEXT,
      "errorMessage" TEXT,
      "preflight" JSONB,
      "fileData" BYTEA,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "AsyncExtractionJob" ADD COLUMN IF NOT EXISTS "fileData" BYTEA`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AsyncExtractionJob_status_idx" ON "AsyncExtractionJob" ("status")`);
}

const publicColumns = `"id","fileName","mimeType","fileSize","checksum","status","openAiResponseId","runId","detectedTicker","detectedCompanyName","detectedYear","detectedPeriodType","errorMessage","preflight","createdAt","updatedAt"`;

export async function findAsyncJobByChecksum(checksum: string) {
  await ensureAsyncExtractionTable();
  const rows = await prisma.$queryRawUnsafe<AsyncJob[]>(`SELECT ${publicColumns} FROM "AsyncExtractionJob" WHERE "checksum" = $1 LIMIT 1`, checksum);
  return rows[0] ?? null;
}

export async function createAsyncJob(input: { id: string; fileName: string; mimeType: string; fileSize: number; checksum: string; preflight: unknown; bytes: Buffer }) {
  await ensureAsyncExtractionTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AsyncExtractionJob" ("id","fileName","mimeType","fileSize","checksum","status","preflight","fileData")
     VALUES ($1,$2,$3,$4,$5,'UPLOADED',$6::jsonb,$7)
     ON CONFLICT ("checksum") DO UPDATE SET
       "fileName"=EXCLUDED."fileName", "mimeType"=EXCLUDED."mimeType", "fileSize"=EXCLUDED."fileSize",
       "status"='UPLOADED', "preflight"=EXCLUDED."preflight", "fileData"=EXCLUDED."fileData",
       "openAiResponseId"=NULL, "runId"=NULL, "detectedTicker"=NULL, "detectedCompanyName"=NULL,
       "detectedYear"=NULL, "detectedPeriodType"=NULL, "errorMessage"=NULL, "updatedAt"=CURRENT_TIMESTAMP
     WHERE "AsyncExtractionJob"."status"='FAILED'`,
    input.id,
    input.fileName,
    input.mimeType,
    input.fileSize,
    input.checksum,
    JSON.stringify(input.preflight),
    input.bytes,
  );
}

export async function markAsyncJobSubmitted(id: string, responseId: string, status: string) {
  const normalizedStatus = status === "queued" || status === "in_progress" ? "PROCESSING" : status.toUpperCase();
  await prisma.$executeRawUnsafe(
    `UPDATE "AsyncExtractionJob" SET "openAiResponseId"=$2,"status"=$3,"fileData"=NULL,"errorMessage"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
    id,
    responseId,
    normalizedStatus,
  );
}

export async function markAsyncJobFailed(id: string, message: string) {
  await ensureAsyncExtractionTable();
  await prisma.$executeRawUnsafe(
    `UPDATE "AsyncExtractionJob" SET "status"='FAILED',"errorMessage"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
    id,
    message.slice(0, 2000),
  );
}

export async function listAsyncJobs() {
  await ensureAsyncExtractionTable();
  return prisma.$queryRawUnsafe<AsyncJob[]>(`SELECT ${publicColumns} FROM "AsyncExtractionJob" WHERE "runId" IS NULL ORDER BY "updatedAt" DESC LIMIT 100`);
}

async function getAsyncJobWithFile(id: string) {
  await ensureAsyncExtractionTable();
  const rows = await prisma.$queryRawUnsafe<AsyncJob[]>(`SELECT * FROM "AsyncExtractionJob" WHERE "id"=$1 LIMIT 1`, id);
  return rows[0] ?? null;
}

export async function submitQueuedAsyncJob(id: string) {
  await ensureAsyncExtractionTable();
  const claimed = await prisma.$executeRawUnsafe(
    `UPDATE "AsyncExtractionJob" SET "status"='SUBMITTING',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='UPLOADED' AND "openAiResponseId" IS NULL AND "fileData" IS NOT NULL`,
    id,
  );
  if (!claimed) return;

  try {
    const job = await getAsyncJobWithFile(id);
    if (!job?.fileData?.length) throw new Error("PDF sementara tidak tersedia untuk dikirim ke OpenAI.");

    const [companies, accounts] = await Promise.all([
      prisma.company.findMany({ where: { isActive: true }, select: { ticker: true, name: true } }),
      prisma.canonicalAccount.findMany({
        where: { isActive: true, isCalculated: false },
        select: { id: true, code: true, name: true, statementType: true, aliases: true },
        orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }],
      }),
    ]);

    const background = await submitFinancialPdfBackground({
      bytes: Buffer.from(job.fileData),
      fileName: job.fileName,
      knownCompanies: companies,
      accounts,
      preflight: job.preflight as Parameters<typeof submitFinancialPdfBackground>[0]["preflight"],
    });
    await markAsyncJobSubmitted(job.id, background.id, background.status);
  } catch (error) {
    await markAsyncJobFailed(id, error instanceof Error ? error.message : "Gagal mengirim PDF ke OpenAI background extraction.");
  }
}

export async function kickQueuedAsyncExtractionJobs(limit = 2) {
  await ensureAsyncExtractionTable();
  await prisma.$executeRawUnsafe(
    `UPDATE "AsyncExtractionJob" SET "status"='UPLOADED',"updatedAt"=CURRENT_TIMESTAMP
     WHERE "status"='SUBMITTING' AND "openAiResponseId" IS NULL AND "fileData" IS NOT NULL AND "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes'`,
  );
  const queued = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "AsyncExtractionJob" WHERE "status"='UPLOADED' AND "openAiResponseId" IS NULL ORDER BY "createdAt" ASC LIMIT $1`,
    limit,
  );
  for (const job of queued) void submitQueuedAsyncJob(job.id);
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function finalizeJob(job: AsyncJob) {
  if (!job.openAiResponseId) return;
  const response = await retrieveFinancialPdfBackground(job.openAiResponseId);
  if (response.status === "queued" || response.status === "in_progress") {
    await prisma.$executeRawUnsafe(`UPDATE "AsyncExtractionJob" SET "status"='PROCESSING',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, job.id);
    return;
  }
  if (response.status !== "completed") {
    const detail = response.error?.message || response.incomplete_details?.reason || `OpenAI background response ${response.status}`;
    await markAsyncJobFailed(job.id, detail);
    return;
  }

  const extracted = parseFinancialExtractionResponse(response);
  const [companies, accounts] = await Promise.all([
    prisma.company.findMany({ where: { isActive: true }, select: { id: true, ticker: true, name: true, currency: true } }),
    prisma.canonicalAccount.findMany({ where: { isActive: true, isCalculated: false }, select: { id: true, code: true, name: true, statementType: true }, orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }] }),
  ]);
  const detectedTicker = normalize(extracted.detectedCompanyTicker);
  const detectedName = normalize(extracted.detectedCompanyName);
  const company = companies.find((item) => normalize(item.ticker) === detectedTicker)
    ?? companies.find((item) => normalize(item.name) === detectedName);

  await prisma.$executeRawUnsafe(
    `UPDATE "AsyncExtractionJob" SET "detectedTicker"=$2,"detectedCompanyName"=$3,"detectedYear"=$4,"detectedPeriodType"=$5,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
    job.id,
    extracted.detectedCompanyTicker,
    extracted.detectedCompanyName,
    extracted.detectedYear,
    extracted.detectedPeriodType,
  );

  if (!company || (extracted.detectedCompanyConfidence ?? 0) < 0.95) {
    await markAsyncJobFailed(job.id, `AI mendeteksi ${extracted.detectedCompanyTicker ?? "?"} — ${extracted.detectedCompanyName ?? "?"}, tetapi emiten belum cocok secara aman dengan Company Master.`);
    return;
  }
  if (!extracted.detectedYear || !extracted.detectedPeriodType || (extracted.detectedPeriodConfidence ?? 0) < 0.75) {
    await markAsyncJobFailed(job.id, "AI belum cukup yakin menentukan periode laporan. Periode perlu dikonfirmasi sebelum staging dibuat.");
    return;
  }

  const existing = await prisma.extractionRun.findUnique({ where: { companyId_checksum: { companyId: company.id, checksum: job.checksum } } });
  if (existing) {
    await prisma.$executeRawUnsafe(`UPDATE "AsyncExtractionJob" SET "status"='COMPLETED',"runId"=$2,"fileData"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, job.id, existing.id);
    return;
  }

  const accountByCode = new Map(accounts.map((account) => [account.code.toUpperCase(), account]));
  const chunks = extracted.chunks.length ? extracted.chunks : [{ section: "Financial Statements", chunkType: "SECTION" as const, pageStart: null, pageEnd: null, textSummary: "AI extraction result" }];
  const preflight = (job.preflight ?? {}) as { processingMode?: string; confidence?: number; reason?: string };

  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.extractionRun.create({ data: {
      companyId: company.id,
      fileName: job.fileName,
      mimeType: job.mimeType,
      fileSize: job.fileSize,
      checksum: job.checksum,
      year: extracted.detectedYear,
      periodType: extracted.detectedPeriodType,
      currency: extracted.detectedCurrency || company.currency,
      unitScale: extracted.detectedUnitScale || null,
      pageCount: extracted.pageCount,
      status: "PROCESSING",
      parserVersion: "mvp-1.2d-v6-ack-first-background",
    } });
    const chunkIds = new Map<number, string>();
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const stored = await tx.extractionChunk.create({ data: {
        runId: run.id,
        ordinal: index + 1,
        chunkType: chunk.chunkType,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        section: chunk.section,
        text: chunk.textSummary.slice(0, 12000),
        textHash: sha256(Buffer.from(chunk.textSummary)),
        metadata: { processingMode: preflight.processingMode, preflightConfidence: preflight.confidence, preflightReason: preflight.reason, openAiResponseId: job.openAiResponseId },
      } });
      chunkIds.set(index, stored.id);
    }
    for (const candidate of extracted.candidates) {
      if (candidate.numericValue === null || !Number.isFinite(candidate.numericValue)) continue;
      const canonical = candidate.canonicalCode ? accountByCode.get(candidate.canonicalCode.toUpperCase()) : undefined;
      const matchingChunk = chunks.findIndex((chunk) => candidate.sourcePage != null && chunk.pageStart != null && chunk.pageEnd != null && candidate.sourcePage >= chunk.pageStart && candidate.sourcePage <= chunk.pageEnd);
      await tx.extractionCandidate.create({ data: {
        runId: run.id,
        chunkId: matchingChunk >= 0 ? chunkIds.get(matchingChunk) ?? null : null,
        statementType: candidate.statementType,
        reportedLabel: candidate.reportedLabel.slice(0, 500),
        normalizedLabel: candidate.reportedLabel.trim().toLowerCase().slice(0, 500),
        rawValue: candidate.rawValue.slice(0, 250),
        numericValue: candidate.numericValue,
        currency: candidate.currency || extracted.detectedCurrency || company.currency,
        scale: candidate.scale || extracted.detectedUnitScale || 1,
        sourcePage: candidate.sourcePage,
        sourceText: candidate.sourceText?.slice(0, 2000) ?? null,
        canonicalAccountId: canonical?.id ?? null,
        extractionConfidence: Math.max(0, Math.min(1, candidate.extractionConfidence)),
        mappingConfidence: canonical ? Math.max(0, Math.min(1, candidate.mappingConfidence)) : 0,
        mappingMethod: canonical ? "AI" : null,
        status: "PENDING",
      } });
    }
    await tx.extractionRun.update({ where: { id: run.id }, data: { status: "PENDING_REVIEW" } });
    return run.id;
  });
  await prisma.$executeRawUnsafe(`UPDATE "AsyncExtractionJob" SET "status"='COMPLETED',"runId"=$2,"fileData"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, job.id, runId);
}

export async function pollAsyncExtractionJobs(limit = 3) {
  const jobs = (await listAsyncJobs()).filter((job) => job.status === "PROCESSING").slice(0, limit);
  for (const job of jobs) {
    try {
      await finalizeJob(job);
    } catch (error) {
      await markAsyncJobFailed(job.id, error instanceof Error ? error.message : "Background extraction gagal.");
    }
  }
}
