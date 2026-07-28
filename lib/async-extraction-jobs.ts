import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type AsyncJobStatus = "UPLOADED" | "PROCESSING" | "PENDING_REVIEW" | "FAILED";
export type AsyncExtractionJob = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  openAiResponseId: string | null;
  status: AsyncJobStatus;
  confirmedCompanyId: string | null;
  runId: string | null;
  errorMessage: string | null;
  preflight: { processingMode?: string; confidence?: number; reason?: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function ensureAsyncJobTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AsyncExtractionJob" (
      "id" TEXT PRIMARY KEY,
      "fileName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
      "fileSize" INTEGER NOT NULL,
      "checksum" TEXT NOT NULL UNIQUE,
      "openAiResponseId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'UPLOADED',
      "confirmedCompanyId" TEXT,
      "runId" TEXT,
      "errorMessage" TEXT,
      "preflight" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AsyncExtractionJob_status_idx" ON "AsyncExtractionJob" ("status")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AsyncExtractionJob_updatedAt_idx" ON "AsyncExtractionJob" ("updatedAt" DESC)`);
}

function mapJob(row: any): AsyncExtractionJob {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    checksum: row.checksum,
    openAiResponseId: row.openAiResponseId,
    status: row.status,
    confirmedCompanyId: row.confirmedCompanyId,
    runId: row.runId,
    errorMessage: row.errorMessage,
    preflight: row.preflight,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export async function findJobByChecksum(checksum: string) {
  await ensureAsyncJobTable();
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AsyncExtractionJob" WHERE "checksum" = $1 LIMIT 1`, checksum);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function findJobById(id: string) {
  await ensureAsyncJobTable();
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AsyncExtractionJob" WHERE "id" = $1 LIMIT 1`, id);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function listActiveJobs() {
  await ensureAsyncJobTable();
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT * FROM "AsyncExtractionJob"
    WHERE "status" IN ('UPLOADED', 'PROCESSING', 'FAILED')
    ORDER BY "updatedAt" DESC
    LIMIT 50
  `);
  return rows.map(mapJob);
}

export async function createAsyncJob(input: { fileName: string; mimeType: string; fileSize: number; checksum: string; confirmedCompanyId?: string | null; preflight: unknown }) {
  await ensureAsyncJobTable();
  const id = randomUUID();
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    INSERT INTO "AsyncExtractionJob" ("id", "fileName", "mimeType", "fileSize", "checksum", "confirmedCompanyId", "preflight")
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    ON CONFLICT ("checksum") DO UPDATE SET "updatedAt" = NOW()
    RETURNING *
  `, id, input.fileName, input.mimeType, input.fileSize, input.checksum, input.confirmedCompanyId ?? null, JSON.stringify(input.preflight));
  return mapJob(rows[0]);
}

export async function updateAsyncJob(id: string, patch: { status?: AsyncJobStatus; openAiResponseId?: string | null; runId?: string | null; errorMessage?: string | null }) {
  await ensureAsyncJobTable();
  const current = await findJobById(id);
  if (!current) return null;
  const next = {
    status: patch.status ?? current.status,
    openAiResponseId: patch.openAiResponseId === undefined ? current.openAiResponseId : patch.openAiResponseId,
    runId: patch.runId === undefined ? current.runId : patch.runId,
    errorMessage: patch.errorMessage === undefined ? current.errorMessage : patch.errorMessage,
  };
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    UPDATE "AsyncExtractionJob"
    SET "status" = $2, "openAiResponseId" = $3, "runId" = $4, "errorMessage" = $5, "updatedAt" = NOW()
    WHERE "id" = $1
    RETURNING *
  `, id, next.status, next.openAiResponseId, next.runId, next.errorMessage);
  return rows[0] ? mapJob(rows[0]) : null;
}
