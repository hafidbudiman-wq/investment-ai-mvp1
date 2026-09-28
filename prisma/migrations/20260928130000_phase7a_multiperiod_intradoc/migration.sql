-- Phase 7A additive intra-document multi-period historical truth.
-- No existing fact rows are rewritten. The legacy report+requirement uniqueness
-- is relaxed so one source revision can hold distinct accounting periods.

DROP INDEX IF EXISTS "P0AFactAssertion_reportRevisionId_requirementId_key";
DROP INDEX IF EXISTS "DerivedMetricResult_runId_definitionId_key";
DROP INDEX IF EXISTS "SegmentFact_runId_segmentId_metricCode_salesScope_key";

ALTER TABLE "P0AFactAssertion"
  ADD COLUMN "temporalIdentityKey" TEXT,
  ADD COLUMN "periodStart" TIMESTAMP(3),
  ADD COLUMN "periodEnd" TIMESTAMP(3),
  ADD COLUMN "periodType" TEXT,
  ADD COLUMN "periodNature" TEXT,
  ADD COLUMN "consolidationScope" TEXT,
  ADD COLUMN "presentationRole" TEXT,
  ADD COLUMN "presentationMetadata" JSONB,
  ADD COLUMN "sourceRevisionHash" TEXT,
  ADD COLUMN "extractionOrigin" TEXT;

CREATE UNIQUE INDEX "P0AFactAssertion_temporalIdentityKey_key" ON "P0AFactAssertion"("temporalIdentityKey");
CREATE INDEX "P0AFactAssertion_companyId_requirementId_periodEnd_idx" ON "P0AFactAssertion"("companyId", "requirementId", "periodEnd");
CREATE INDEX "P0AFactAssertion_reportRevisionId_periodEnd_idx" ON "P0AFactAssertion"("reportRevisionId", "periodEnd");

ALTER TABLE "DividendEvent"
  ADD COLUMN "intraDocumentEventKey" TEXT;
CREATE UNIQUE INDEX "DividendEvent_intraDocumentEventKey_key" ON "DividendEvent"("intraDocumentEventKey");

ALTER TABLE "SegmentDimension"
  ADD COLUMN "continuityKey" TEXT,
  ADD COLUMN "continuityValidFrom" TIMESTAMP(3),
  ADD COLUMN "continuityValidTo" TIMESTAMP(3),
  ADD COLUMN "presentationMetadata" JSONB;
CREATE INDEX "SegmentDimension_companyId_continuityKey_idx" ON "SegmentDimension"("companyId", "continuityKey");

ALTER TABLE "SegmentFact"
  ADD COLUMN "presentationRole" TEXT,
  ADD COLUMN "presentationMetadata" JSONB;

ALTER TABLE "DerivedMetricResult"
  ADD COLUMN "presentationRole" TEXT,
  ADD COLUMN "sourceRevisionHash" TEXT;

CREATE UNIQUE INDEX "DerivedMetricResult_runId_definitionId_periodStart_periodEnd_key"
  ON "DerivedMetricResult"("runId", "definitionId", "periodStart", "periodEnd");

CREATE UNIQUE INDEX "SegmentFact_runId_segmentId_metricCode_salesScope_periodStart_periodEnd_key"
  ON "SegmentFact"("runId", "segmentId", "metricCode", "salesScope", "periodStart", "periodEnd");

CREATE TABLE "Phase7AExtractionRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "reportRevisionId" TEXT NOT NULL,
  "manifestVersion" TEXT NOT NULL,
  "extractorVersion" TEXT NOT NULL,
  "completeIdentityHash" TEXT NOT NULL,
  "sourceRevisionHash" TEXT NOT NULL,
  "currentPeriod" JSONB NOT NULL,
  "comparativePeriods" JSONB NOT NULL,
  "selectedPages" JSONB NOT NULL,
  "validationSummary" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "providerCalls" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Phase7AExtractionRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Phase7AExtractionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Phase7AExtractionRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Phase7AExtractionRun_reportRevisionId_fkey" FOREIGN KEY ("reportRevisionId") REFERENCES "P0AReportRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Phase7AExtractionRun_zero_provider_check" CHECK ("providerCalls" = 0 AND "inputTokens" = 0 AND "outputTokens" = 0 AND "estimatedCostUsd" = 0)
);
CREATE UNIQUE INDEX "Phase7AExtractionRun_completeIdentityHash_key" ON "Phase7AExtractionRun"("completeIdentityHash");
CREATE INDEX "Phase7AExtractionRun_documentId_status_idx" ON "Phase7AExtractionRun"("documentId", "status");
CREATE INDEX "Phase7AExtractionRun_reportRevisionId_idx" ON "Phase7AExtractionRun"("reportRevisionId");
CREATE INDEX "Phase7AExtractionRun_companyId_sourceRevisionHash_idx" ON "Phase7AExtractionRun"("companyId", "sourceRevisionHash");

CREATE TABLE "Phase7AOutcome" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Phase7AOutcome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Phase7AOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Phase7AExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Phase7AOutcome_runId_code_key" ON "Phase7AOutcome"("runId", "code");
CREATE INDEX "Phase7AOutcome_runId_state_idx" ON "Phase7AOutcome"("runId", "state");
