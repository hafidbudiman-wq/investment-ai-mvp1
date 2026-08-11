-- Align the legacy object-storage upload constraints with the PostgreSQL-backed
-- resumable path used by mobile PDF uploads. Existing upload modes and statuses
-- remain valid; no report or canonical financial data is changed.
ALTER TABLE "UploadSession"
  DROP CONSTRAINT IF EXISTS "UploadSession_mode_check";

ALTER TABLE "UploadSession"
  ADD CONSTRAINT "UploadSession_mode_check"
  CHECK ("uploadMode" IN ('SINGLE_PUT', 'MULTIPART', 'DATABASE_CHUNKED'));

ALTER TABLE "UploadSession"
  DROP CONSTRAINT IF EXISTS "UploadSession_part_size_check";

ALTER TABLE "UploadSession"
  ADD CONSTRAINT "UploadSession_part_size_check" CHECK (
    ("uploadMode" = 'SINGLE_PUT' AND "partSize" IS NULL)
    OR ("uploadMode" = 'MULTIPART' AND "partSize" IS NOT NULL AND "partSize" >= 5242880)
    OR ("uploadMode" = 'DATABASE_CHUNKED' AND "partSize" = 1048576)
  );

ALTER TABLE "UploadSession"
  DROP CONSTRAINT IF EXISTS "UploadSession_status_check";

ALTER TABLE "UploadSession"
  ADD CONSTRAINT "UploadSession_status_check"
  CHECK ("status" IN (
    'INITIATED', 'UPLOADING', 'UPLOADED', 'VERIFYING', 'VERIFIED',
    'COMPLETED', 'DUPLICATE', 'ABORTED', 'FAILED'
  ));
