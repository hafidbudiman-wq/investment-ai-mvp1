-- Phase 4 makes extraction-pass identity complete and preserves routing history.
-- Existing rows are retained. Unknown historical versions are explicitly marked;
-- current Phase 3 version labels are never fabricated during backfill.

ALTER TABLE "P0AExtractionPass"
  ADD COLUMN "routingSnapshot" JSONB;

UPDATE "P0AExtractionPass"
SET "mappingVersion" = 'legacy-unversioned'
WHERE "mappingVersion" IS NULL;

UPDATE "P0AExtractionPass"
SET "scopedPromptVersion" = 'legacy-unversioned'
WHERE "scopedPromptVersion" IS NULL;

ALTER TABLE "P0AExtractionPass"
  ALTER COLUMN "mappingVersion" SET NOT NULL,
  ALTER COLUMN "scopedPromptVersion" SET NOT NULL;

DROP INDEX "P0AExtractionPass_documentId_contractVersion_parserVersion__key";

CREATE UNIQUE INDEX "P0AExtractionPass_complete_identity_key"
ON "P0AExtractionPass"(
  "documentId",
  "contractVersion",
  "parserVersion",
  "routerVersion",
  "applicabilityVersion",
  "plannerVersion",
  "gapVersion",
  "validationVersion",
  "mappingVersion",
  "scopedPromptVersion",
  "contextHash",
  "shadowMode"
);

DROP INDEX "P0AReportRevision_contextHash_key";
CREATE INDEX "P0AReportRevision_contextHash_idx"
ON "P0AReportRevision"("contextHash");
