-- Idempotent adoption baseline for legacy InvestAI financial/extraction tables.
-- Safe for an empty database and for Railway databases previously created with prisma db push.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReportPeriodType" AS ENUM ('Q1', 'H1', 'Q3', 'FY', 'MONTHLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "StatementType" AS ENUM ('INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'PDF', 'EXCEL', 'API');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ValueNature" AS ENUM ('FLOW', 'STOCK', 'PER_SHARE', 'RATIO', 'TEXT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MappingMethod" AS ENUM ('MANUAL', 'RULE', 'AI');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WarningSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ExtractionRunStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PENDING_REVIEW', 'READY_TO_COMMIT', 'COMMITTED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ExtractionCandidateStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'COMMITTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ExtractionChunkType" AS ENUM ('SECTION', 'TABLE', 'PAGE', 'TOKEN_BLOCK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Company" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT,
    "subsector" TEXT,
    "country" TEXT NOT NULL DEFAULT 'ID',
    "ipoYear" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "fiscalYearEnd" INTEGER NOT NULL DEFAULT 12,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FinancialReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "periodType" "ReportPeriodType" NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "audited" BOOLEAN NOT NULL DEFAULT false,
    "consolidated" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceFile" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FinancialStatement" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "statementType" "StatementType" NOT NULL,
    "currency" TEXT NOT NULL,
    "unitScale" INTEGER NOT NULL DEFAULT 1,
    "isConsolidated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CanonicalAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayNameId" TEXT,
    "description" TEXT,
    "definition" TEXT,
    "investorMeaning" TEXT,
    "aliases" JSONB,
    "relatedMetrics" JSONB,
    "positiveSignals" JSONB,
    "redFlags" JSONB,
    "sectorNotes" JSONB,
    "sourceRefs" JSONB,
    "statementType" "StatementType" NOT NULL,
    "valueNature" "ValueNature" NOT NULL DEFAULT 'FLOW',
    "normalBalance" TEXT,
    "parentId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCalculated" BOOLEAN NOT NULL DEFAULT false,
    "formula" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FinancialEntry" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "statementId" TEXT,
    "canonicalAccountId" TEXT NOT NULL,
    "reportedLabel" TEXT,
    "rawText" TEXT,
    "value" DECIMAL(28,6) NOT NULL,
    "originalValue" DECIMAL(28,6),
    "normalizedValue" DECIMAL(38,6),
    "originalRawValue" TEXT,
    "scale" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "signConvention" TEXT,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "sourcePage" INTEGER,
    "sourceDocumentId" TEXT,
    "extractionRunId" TEXT,
    "sourceCandidateIds" JSONB,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'VERIFIED',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountMapping" (
    "id" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "normalizedLabel" TEXT,
    "companyId" TEXT,
    "statementType" "StatementType",
    "canonicalAccountId" TEXT NOT NULL,
    "method" "MappingMethod" NOT NULL DEFAULT 'MANUAL',
    "confidence" DOUBLE PRECISION,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DataWarning" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataWarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SourceFile" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "checksum" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "reportId" TEXT,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "entity" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExtractionRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reportId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "year" INTEGER,
    "periodType" "ReportPeriodType",
    "currency" TEXT,
    "unitScale" INTEGER,
    "status" "ExtractionRunStatus" NOT NULL DEFAULT 'UPLOADED',
    "parserVersion" TEXT NOT NULL DEFAULT 'mvp-1.2d-v1',
    "pageCount" INTEGER,
    "errorMessage" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExtractionChunk" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "chunkType" "ExtractionChunkType" NOT NULL,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "section" TEXT,
    "text" TEXT NOT NULL,
    "textHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExtractionCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chunkId" TEXT,
    "statementType" "StatementType",
    "reportedLabel" TEXT NOT NULL,
    "normalizedLabel" TEXT,
    "rawValue" TEXT NOT NULL,
    "numericValue" DECIMAL(28,6),
    "currency" TEXT,
    "scale" INTEGER NOT NULL DEFAULT 1,
    "sourcePage" INTEGER,
    "sourceText" TEXT,
    "canonicalAccountId" TEXT,
    "extractionConfidence" DOUBLE PRECISION,
    "mappingConfidence" DOUBLE PRECISION,
    "mappingMethod" "MappingMethod",
    "status" "ExtractionCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AsyncExtractionJob" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "openAiResponseId" TEXT,
    "runId" TEXT,
    "documentId" TEXT,
    "detectedTicker" TEXT,
    "detectedCompanyName" TEXT,
    "detectedYear" INTEGER,
    "detectedPeriodType" TEXT,
    "errorMessage" TEXT,
    "preflight" JSONB,
    "fileData" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsyncExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Company_ticker_key" ON "Company"("ticker");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FinancialReport_companyId_periodEnd_idx" ON "FinancialReport"("companyId", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FinancialReport_status_idx" ON "FinancialReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FinancialReport_companyId_year_periodType_key" ON "FinancialReport"("companyId", "year", "periodType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FinancialStatement_reportId_statementType_key" ON "FinancialStatement"("reportId", "statementType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CanonicalAccount_code_key" ON "CanonicalAccount"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CanonicalAccount_statementType_sortOrder_idx" ON "CanonicalAccount"("statementType", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CanonicalAccount_parentId_idx" ON "CanonicalAccount"("parentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FinancialEntry_canonicalAccountId_idx" ON "FinancialEntry"("canonicalAccountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FinancialEntry_statementId_idx" ON "FinancialEntry"("statementId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FinancialEntry_sourceDocumentId_idx" ON "FinancialEntry"("sourceDocumentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FinancialEntry_extractionRunId_idx" ON "FinancialEntry"("extractionRunId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FinancialEntry_reportId_canonicalAccountId_key" ON "FinancialEntry"("reportId", "canonicalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountMapping_sourceLabel_key" ON "AccountMapping"("sourceLabel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountMapping_normalizedLabel_idx" ON "AccountMapping"("normalizedLabel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountMapping_companyId_statementType_idx" ON "AccountMapping"("companyId", "statementType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DataWarning_reportId_resolved_idx" ON "DataWarning"("reportId", "resolved");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DataWarning_severity_idx" ON "DataWarning"("severity");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourceFile_reportId_idx" ON "SourceFile"("reportId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_reportId_createdAt_idx" ON "AuditLog"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractionRun_companyId_createdAt_idx" ON "ExtractionRun"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractionRun_status_idx" ON "ExtractionRun"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractionRun_documentId_idx" ON "ExtractionRun"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExtractionRun_companyId_checksum_key" ON "ExtractionRun"("companyId", "checksum");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractionChunk_runId_pageStart_idx" ON "ExtractionChunk"("runId", "pageStart");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExtractionChunk_runId_ordinal_key" ON "ExtractionChunk"("runId", "ordinal");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractionCandidate_runId_status_idx" ON "ExtractionCandidate"("runId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractionCandidate_canonicalAccountId_idx" ON "ExtractionCandidate"("canonicalAccountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractionCandidate_chunkId_idx" ON "ExtractionCandidate"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AsyncExtractionJob_checksum_key" ON "AsyncExtractionJob"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AsyncExtractionJob_runId_key" ON "AsyncExtractionJob"("runId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AsyncExtractionJob_status_createdAt_idx" ON "AsyncExtractionJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AsyncExtractionJob_documentId_idx" ON "AsyncExtractionJob"("documentId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinancialReport_companyId_fkey') THEN
    ALTER TABLE "FinancialReport" ADD CONSTRAINT "FinancialReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinancialStatement_reportId_fkey') THEN
    ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FinancialReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalAccount_parentId_fkey') THEN
    ALTER TABLE "CanonicalAccount" ADD CONSTRAINT "CanonicalAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CanonicalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinancialEntry_reportId_fkey') THEN
    ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FinancialReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinancialEntry_statementId_fkey') THEN
    ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "FinancialStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinancialEntry_canonicalAccountId_fkey') THEN
    ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_canonicalAccountId_fkey" FOREIGN KEY ("canonicalAccountId") REFERENCES "CanonicalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinancialEntry_extractionRunId_fkey') THEN
    ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "ExtractionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountMapping_canonicalAccountId_fkey') THEN
    ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_canonicalAccountId_fkey" FOREIGN KEY ("canonicalAccountId") REFERENCES "CanonicalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DataWarning_reportId_fkey') THEN
    ALTER TABLE "DataWarning" ADD CONSTRAINT "DataWarning_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FinancialReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SourceFile_reportId_fkey') THEN
    ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FinancialReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_reportId_fkey') THEN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FinancialReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractionRun_companyId_fkey') THEN
    ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractionRun_reportId_fkey') THEN
    ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FinancialReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractionChunk_runId_fkey') THEN
    ALTER TABLE "ExtractionChunk" ADD CONSTRAINT "ExtractionChunk_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractionCandidate_runId_fkey') THEN
    ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractionCandidate_chunkId_fkey') THEN
    ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ExtractionChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractionCandidate_canonicalAccountId_fkey') THEN
    ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_canonicalAccountId_fkey" FOREIGN KEY ("canonicalAccountId") REFERENCES "CanonicalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsyncExtractionJob_runId_fkey') THEN
    ALTER TABLE "AsyncExtractionJob" ADD CONSTRAINT "AsyncExtractionJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
