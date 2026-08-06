-- Add durable PostgreSQL source bytes and explicit lineage to the extraction flow.
-- All operations are additive and safe for databases previously created by db push.

ALTER TABLE "FinancialDocument" ADD COLUMN IF NOT EXISTS "content" BYTEA;
ALTER TABLE "ExtractionRun" ADD COLUMN IF NOT EXISTS "documentId" TEXT;
ALTER TABLE "AsyncExtractionJob" ADD COLUMN IF NOT EXISTS "documentId" TEXT;

CREATE INDEX IF NOT EXISTS "ExtractionRun_documentId_idx" ON "ExtractionRun"("documentId");
CREATE INDEX IF NOT EXISTS "AsyncExtractionJob_documentId_idx" ON "AsyncExtractionJob"("documentId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractionRun_documentId_fkey') THEN
    ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsyncExtractionJob_documentId_fkey') THEN
    ALTER TABLE "AsyncExtractionJob" ADD CONSTRAINT "AsyncExtractionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
