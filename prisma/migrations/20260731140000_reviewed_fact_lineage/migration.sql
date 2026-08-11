-- Preserve original and normalized reviewed values plus complete extraction lineage.

ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "originalValue" DECIMAL(28,6);
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "normalizedValue" DECIMAL(38,6);
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "originalRawValue" TEXT;
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "signConvention" TEXT;
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "sourceDocumentId" TEXT;
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "extractionRunId" TEXT;
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "sourceCandidateIds" JSONB;
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'VERIFIED';
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE "FinancialEntry" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "FinancialEntry_sourceDocumentId_idx" ON "FinancialEntry"("sourceDocumentId");
CREATE INDEX IF NOT EXISTS "FinancialEntry_extractionRunId_idx" ON "FinancialEntry"("extractionRunId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinancialEntry_sourceDocumentId_fkey') THEN
    ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "FinancialDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinancialEntry_extractionRunId_fkey') THEN
    ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "ExtractionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
