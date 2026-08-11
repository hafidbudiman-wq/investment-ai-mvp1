-- Additive canonical-quality metadata for deterministic auto-review.
ALTER TABLE "ExtractionCandidate"
  ADD COLUMN IF NOT EXISTS "candidateRole" TEXT NOT NULL DEFAULT 'FINAL_FACT',
  ADD COLUMN IF NOT EXISTS "componentOf" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityStatus" TEXT NOT NULL DEFAULT 'YELLOW',
  ADD COLUMN IF NOT EXISTS "qualityReasons" JSONB;

CREATE TABLE IF NOT EXISTS "CompanyAccountMapping" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "statementType" "StatementType" NOT NULL,
  "normalizedLabel" TEXT NOT NULL,
  "sourceLabel" TEXT NOT NULL,
  "canonicalAccountId" TEXT NOT NULL,
  "method" "MappingMethod" NOT NULL DEFAULT 'RULE',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "evidenceCount" INTEGER NOT NULL DEFAULT 1,
  "isApproved" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyAccountMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyAccountMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanyAccountMapping_canonicalAccountId_fkey" FOREIGN KEY ("canonicalAccountId") REFERENCES "CanonicalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyAccountMapping_companyId_statementType_normalizedLabel_key"
  ON "CompanyAccountMapping"("companyId", "statementType", "normalizedLabel");
CREATE INDEX IF NOT EXISTS "CompanyAccountMapping_canonicalAccountId_idx"
  ON "CompanyAccountMapping"("canonicalAccountId");
CREATE INDEX IF NOT EXISTS "CompanyAccountMapping_companyId_isApproved_idx"
  ON "CompanyAccountMapping"("companyId", "isApproved");
