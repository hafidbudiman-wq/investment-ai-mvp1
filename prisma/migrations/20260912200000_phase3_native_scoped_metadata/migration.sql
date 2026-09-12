-- Phase 3 adds lineage/mapping metadata only to the isolated P0-A shadow family.
-- This migration is intentionally not executed against production in Phase 3.
ALTER TABLE "P0AExtractionPass"
  ADD COLUMN "mappingVersion" TEXT,
  ADD COLUMN "scopedPromptVersion" TEXT;

ALTER TABLE "P0AFactEvidence"
  ADD COLUMN "rowIndex" INTEGER,
  ADD COLUMN "columnIndex" INTEGER;

ALTER TABLE "P0AFactAssertion"
  ADD COLUMN "rawLabel" TEXT,
  ADD COLUMN "statement" TEXT,
  ADD COLUMN "readConfidence" DECIMAL(5,4),
  ADD COLUMN "mappingConfidence" DECIMAL(5,4);
