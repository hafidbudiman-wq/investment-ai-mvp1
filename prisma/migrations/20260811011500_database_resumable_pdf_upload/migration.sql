-- Temporary PostgreSQL-backed chunks make mobile uploads resumable without
-- requiring an external object-storage service. Chunk bytes are deleted after
-- the verified FinancialDocument and extraction job have been created.
ALTER TABLE "UploadSession" ADD COLUMN "checksum" TEXT;
UPDATE "UploadSession" SET "checksum" = repeat('0', 64) WHERE "checksum" IS NULL;
ALTER TABLE "UploadSession" ALTER COLUMN "checksum" SET NOT NULL;

ALTER TABLE "UploadPart" ADD COLUMN "content" BYTEA;

CREATE INDEX "UploadSession_checksum_status_idx" ON "UploadSession"("checksum", "status");
