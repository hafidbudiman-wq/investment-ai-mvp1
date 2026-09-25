-- Phase 6B is strictly additive. Dividend events and segment facts remain
-- separate from legacy scalar FinancialEntry and frozen P0-A/P0-B tables.
CREATE TABLE "Phase6BExtractionRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reportRevisionId" TEXT NOT NULL,
    "manifestVersion" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "dimensionSchemaVersion" TEXT NOT NULL,
    "completeIdentityHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "selectedPages" JSONB NOT NULL,
    "providerCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Phase6BExtractionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Phase6BRequirementOutcome" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "applicability" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "factCount" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "attemptedPages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Phase6BRequirementOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DividendEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reportRevisionId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceProfitPeriodStart" TIMESTAMP(3),
    "sourceProfitPeriodEnd" TIMESTAMP(3),
    "declarationDate" TIMESTAMP(3),
    "approvalDate" TIMESTAMP(3),
    "recordDate" TIMESTAMP(3),
    "cumDate" TIMESTAMP(3),
    "exDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "paymentDatePrecision" TEXT,
    "paymentDateRaw" TEXT,
    "recipientScope" TEXT NOT NULL,
    "shareClass" TEXT,
    "totalReportedValue" DECIMAL(38,6),
    "totalAmount" DECIMAL(38,6),
    "totalRawValue" TEXT,
    "totalCurrency" TEXT,
    "totalScale" DECIMAL(38,6),
    "perShareReportedValue" DECIMAL(38,6),
    "perShareAmount" DECIMAL(38,6),
    "perShareRawValue" TEXT,
    "perShareCurrency" TEXT,
    "perShareScale" DECIMAL(38,6),
    "fieldStates" JSONB NOT NULL,
    "definitionVersion" TEXT NOT NULL,
    "sourceRevisionHash" TEXT NOT NULL,
    "extractionOrigin" TEXT NOT NULL,
    "readConfidence" DECIMAL(5,4),
    "mappingConfidence" DECIMAL(5,4),
    "validationStatus" TEXT NOT NULL,
    "validationControls" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DividendEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DividendEventEvidence" (
    "eventId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DividendEventEvidence_pkey" PRIMARY KEY ("eventId", "evidenceId", "fieldName")
);

CREATE TABLE "SegmentDimension" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "normalizedLabel" TEXT NOT NULL,
    "segmentType" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "definitionVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SegmentDimension_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SegmentIdentityEvidence" (
    "segmentId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SegmentIdentityEvidence_pkey" PRIMARY KEY ("segmentId", "evidenceId")
);

CREATE TABLE "SegmentFact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reportRevisionId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "metricCode" TEXT NOT NULL,
    "metricLabel" TEXT NOT NULL,
    "sourceMetricLabel" TEXT NOT NULL,
    "periodColumn" TEXT NOT NULL,
    "salesScope" TEXT,
    "valueState" TEXT NOT NULL,
    "reportedValue" DECIMAL(38,6) NOT NULL,
    "normalizedValue" DECIMAL(38,6) NOT NULL,
    "rawValue" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "scale" DECIMAL(38,6) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodType" TEXT NOT NULL,
    "consolidationScope" TEXT NOT NULL,
    "dimensionSchemaVersion" TEXT NOT NULL,
    "dimensionHash" TEXT NOT NULL,
    "definitionVersion" TEXT NOT NULL,
    "sourceRevisionHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'REPORTED',
    "extractionOrigin" TEXT NOT NULL,
    "readConfidence" DECIMAL(5,4),
    "mappingConfidence" DECIMAL(5,4),
    "validationStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SegmentFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SegmentFactEvidence" (
    "factId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SegmentFactEvidence_pkey" PRIMARY KEY ("factId", "evidenceId")
);

CREATE UNIQUE INDEX "Phase6BExtractionRun_completeIdentityHash_key" ON "Phase6BExtractionRun"("completeIdentityHash");
CREATE INDEX "Phase6BExtractionRun_documentId_status_idx" ON "Phase6BExtractionRun"("documentId", "status");
CREATE INDEX "Phase6BExtractionRun_reportRevisionId_idx" ON "Phase6BExtractionRun"("reportRevisionId");
CREATE UNIQUE INDEX "Phase6BRequirementOutcome_runId_requirementId_key" ON "Phase6BRequirementOutcome"("runId", "requirementId");
CREATE INDEX "Phase6BRequirementOutcome_runId_state_idx" ON "Phase6BRequirementOutcome"("runId", "state");
CREATE UNIQUE INDEX "DividendEvent_eventKey_key" ON "DividendEvent"("eventKey");
CREATE INDEX "DividendEvent_companyId_approvalDate_idx" ON "DividendEvent"("companyId", "approvalDate");
CREATE INDEX "DividendEvent_reportRevisionId_idx" ON "DividendEvent"("reportRevisionId");
CREATE INDEX "DividendEvent_runId_idx" ON "DividendEvent"("runId");
CREATE UNIQUE INDEX "DividendEventEvidence_eventId_fieldName_ordinal_key" ON "DividendEventEvidence"("eventId", "fieldName", "ordinal");
CREATE INDEX "DividendEventEvidence_evidenceId_idx" ON "DividendEventEvidence"("evidenceId");
CREATE UNIQUE INDEX "SegmentDimension_identityKey_key" ON "SegmentDimension"("identityKey");
CREATE INDEX "SegmentDimension_companyId_normalizedLabel_idx" ON "SegmentDimension"("companyId", "normalizedLabel");
CREATE INDEX "SegmentDimension_companyId_validFrom_validTo_idx" ON "SegmentDimension"("companyId", "validFrom", "validTo");
CREATE UNIQUE INDEX "SegmentIdentityEvidence_segmentId_ordinal_key" ON "SegmentIdentityEvidence"("segmentId", "ordinal");
CREATE INDEX "SegmentIdentityEvidence_evidenceId_idx" ON "SegmentIdentityEvidence"("evidenceId");
CREATE UNIQUE INDEX "SegmentFact_factKey_key" ON "SegmentFact"("factKey");
CREATE UNIQUE INDEX "SegmentFact_runId_segmentId_metricCode_salesScope_key" ON "SegmentFact"("runId", "segmentId", "metricCode", "salesScope");
CREATE INDEX "SegmentFact_companyId_metricCode_periodEnd_idx" ON "SegmentFact"("companyId", "metricCode", "periodEnd");
CREATE INDEX "SegmentFact_reportRevisionId_idx" ON "SegmentFact"("reportRevisionId");
CREATE INDEX "SegmentFact_segmentId_idx" ON "SegmentFact"("segmentId");
CREATE UNIQUE INDEX "SegmentFactEvidence_factId_ordinal_key" ON "SegmentFactEvidence"("factId", "ordinal");
CREATE INDEX "SegmentFactEvidence_evidenceId_idx" ON "SegmentFactEvidence"("evidenceId");

ALTER TABLE "Phase6BExtractionRun" ADD CONSTRAINT "Phase6BExtractionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Phase6BExtractionRun" ADD CONSTRAINT "Phase6BExtractionRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Phase6BExtractionRun" ADD CONSTRAINT "Phase6BExtractionRun_reportRevisionId_fkey" FOREIGN KEY ("reportRevisionId") REFERENCES "P0AReportRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Phase6BRequirementOutcome" ADD CONSTRAINT "Phase6BRequirementOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Phase6BExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DividendEvent" ADD CONSTRAINT "DividendEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Phase6BExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DividendEvent" ADD CONSTRAINT "DividendEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DividendEvent" ADD CONSTRAINT "DividendEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DividendEvent" ADD CONSTRAINT "DividendEvent_reportRevisionId_fkey" FOREIGN KEY ("reportRevisionId") REFERENCES "P0AReportRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DividendEventEvidence" ADD CONSTRAINT "DividendEventEvidence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DividendEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DividendEventEvidence" ADD CONSTRAINT "DividendEventEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "P0AFactEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentDimension" ADD CONSTRAINT "SegmentDimension_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentIdentityEvidence" ADD CONSTRAINT "SegmentIdentityEvidence_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "SegmentDimension"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentIdentityEvidence" ADD CONSTRAINT "SegmentIdentityEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "P0AFactEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentFact" ADD CONSTRAINT "SegmentFact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Phase6BExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentFact" ADD CONSTRAINT "SegmentFact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentFact" ADD CONSTRAINT "SegmentFact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentFact" ADD CONSTRAINT "SegmentFact_reportRevisionId_fkey" FOREIGN KEY ("reportRevisionId") REFERENCES "P0AReportRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentFact" ADD CONSTRAINT "SegmentFact_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "SegmentDimension"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SegmentFactEvidence" ADD CONSTRAINT "SegmentFactEvidence_factId_fkey" FOREIGN KEY ("factId") REFERENCES "SegmentFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentFactEvidence" ADD CONSTRAINT "SegmentFactEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "P0AFactEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
