-- InvestAI P0-A additive ingestion foundation.
-- No legacy FinancialEntry, ExtractionRun, or commit-path row is rewritten.

ALTER TABLE "Job" DROP CONSTRAINT "Job_status_check";
ALTER TABLE "Job" ADD CONSTRAINT "Job_status_check" CHECK ("status" IN ('QUEUED','CLAIMED','RUNNING','RETRY_WAIT','NEEDS_INPUT','SUBMISSION_UNKNOWN','SUCCEEDED','FAILED','CANCELLED'));
ALTER TABLE "JobAttempt" DROP CONSTRAINT "JobAttempt_status_check";
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_status_check" CHECK ("status" IN ('CLAIMED','RUNNING','SUBMISSION_UNKNOWN','LEASE_EXPIRED','SUCCEEDED','FAILED','CANCELLED'));

CREATE TABLE "P0ADocumentPage" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "pageWidth" DOUBLE PRECISION NOT NULL,
  "pageHeight" DOUBLE PRECISION NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "textHash" TEXT NOT NULL,
  "layoutHash" TEXT NOT NULL,
  "printedPageLabel" TEXT,
  "pageClass" TEXT,
  "classifierVersion" TEXT,
  "extractionStatus" TEXT NOT NULL,
  "characterCount" INTEGER NOT NULL,
  "tokens" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "P0ADocumentPage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0ADocumentPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0ADocumentPage_number_check" CHECK ("pageNumber" > 0),
  CONSTRAINT "P0ADocumentPage_character_count_check" CHECK ("characterCount" >= 0)
);

CREATE UNIQUE INDEX "P0ADocumentPage_documentId_pageNumber_parserVersion_key" ON "P0ADocumentPage"("documentId", "pageNumber", "parserVersion");
CREATE INDEX "P0ADocumentPage_documentId_pageClass_idx" ON "P0ADocumentPage"("documentId", "pageClass");

CREATE TABLE "P0AExtractionPass" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "routerVersion" TEXT NOT NULL,
  "applicabilityVersion" TEXT NOT NULL,
  "plannerVersion" TEXT NOT NULL,
  "gapVersion" TEXT NOT NULL,
  "validationVersion" TEXT NOT NULL,
  "contextHash" TEXT NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "shadowMode" BOOLEAN NOT NULL DEFAULT true,
  "pageIndexCacheHit" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL,
  "primaryPages" JSONB NOT NULL,
  "targetedPages" JSONB NOT NULL,
  "selectedPages" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "P0AExtractionPass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0AExtractionPass_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "P0AExtractionPass_documentId_contractVersion_parserVersion__key" ON "P0AExtractionPass"("documentId", "contractVersion", "parserVersion", "routerVersion", "plannerVersion", "contextHash", "shadowMode");
CREATE INDEX "P0AExtractionPass_documentId_status_idx" ON "P0AExtractionPass"("documentId", "status");

CREATE TABLE "P0AExtractionTask" (
  "id" TEXT NOT NULL,
  "passId" TEXT NOT NULL,
  "jobId" TEXT,
  "stage" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "taskKey" TEXT NOT NULL,
  "requirementIds" JSONB NOT NULL,
  "selectedPages" JSONB NOT NULL,
  "selectedPageCount" INTEGER NOT NULL,
  "requirementCount" INTEGER NOT NULL,
  "documentPageCount" INTEGER NOT NULL,
  "validatedFactCount" INTEGER NOT NULL DEFAULT 0,
  "executionMode" TEXT NOT NULL DEFAULT 'SCOPED_PAGE',
  "status" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "providerRequestId" TEXT,
  "providerResponseId" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "processingLatencyMs" INTEGER,
  "estimatedCostUsd" DECIMAL(18,8),
  "billedCostUsd" DECIMAL(18,8),
  "providerCalls" INTEGER NOT NULL DEFAULT 0,
  "inputHash" TEXT NOT NULL,
  "outputHash" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "P0AExtractionTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0AExtractionTask_passId_fkey" FOREIGN KEY ("passId") REFERENCES "P0AExtractionPass"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0AExtractionTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "P0AExtractionTask_usage_check" CHECK ("retryCount" >= 0 AND "providerCalls" >= 0 AND "selectedPageCount" >= 0 AND "requirementCount" >= 0 AND "documentPageCount" >= "selectedPageCount" AND "validatedFactCount" >= 0 AND COALESCE("inputTokens", 0) >= 0 AND COALESCE("outputTokens", 0) >= 0 AND COALESCE("processingLatencyMs", 0) >= 0)
);

CREATE UNIQUE INDEX "P0AExtractionTask_jobId_key" ON "P0AExtractionTask"("jobId");
CREATE UNIQUE INDEX "P0AExtractionTask_taskKey_key" ON "P0AExtractionTask"("taskKey");
CREATE INDEX "P0AExtractionTask_passId_stage_idx" ON "P0AExtractionTask"("passId", "stage");
CREATE INDEX "P0AExtractionTask_provider_model_idx" ON "P0AExtractionTask"("provider", "model");

CREATE TABLE "P0AReportRevision" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "passId" TEXT NOT NULL,
  "contextHash" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "periodType" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "documentScale" DECIMAL(38,6) NOT NULL,
  "consolidated" BOOLEAN,
  "audited" BOOLEAN,
  "status" TEXT NOT NULL DEFAULT 'SHADOW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "P0AReportRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0AReportRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0AReportRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0AReportRevision_passId_fkey" FOREIGN KEY ("passId") REFERENCES "P0AExtractionPass"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "P0AReportRevision_passId_key" ON "P0AReportRevision"("passId");
CREATE UNIQUE INDEX "P0AReportRevision_contextHash_key" ON "P0AReportRevision"("contextHash");
CREATE INDEX "P0AReportRevision_companyId_periodEnd_idx" ON "P0AReportRevision"("companyId", "periodEnd");
CREATE INDEX "P0AReportRevision_documentId_idx" ON "P0AReportRevision"("documentId");

CREATE TABLE "P0AFactAssertion" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "reportRevisionId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "definitionVersion" TEXT NOT NULL,
  "assertionKey" TEXT NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'REPORTED',
  "valueState" TEXT NOT NULL,
  "decimalValue" DECIMAL(38,6),
  "rawValue" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "unitType" TEXT NOT NULL,
  "scale" DECIMAL(38,6) NOT NULL,
  "lineageStatus" TEXT NOT NULL DEFAULT 'COMPLETE',
  "status" TEXT NOT NULL DEFAULT 'SHADOW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "P0AFactAssertion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0AFactAssertion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0AFactAssertion_reportRevisionId_fkey" FOREIGN KEY ("reportRevisionId") REFERENCES "P0AReportRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0AFactAssertion_reported_only_check" CHECK ("origin" = 'REPORTED')
);

CREATE UNIQUE INDEX "P0AFactAssertion_assertionKey_key" ON "P0AFactAssertion"("assertionKey");
CREATE UNIQUE INDEX "P0AFactAssertion_reportRevisionId_requirementId_key" ON "P0AFactAssertion"("reportRevisionId", "requirementId");
CREATE INDEX "P0AFactAssertion_companyId_requirementId_idx" ON "P0AFactAssertion"("companyId", "requirementId");

CREATE TABLE "P0ARequirementOutcome" (
  "id" TEXT NOT NULL,
  "passId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "applicability" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "reportedAssertionId" TEXT,
  "attemptedRoutes" JSONB NOT NULL,
  "attemptedPages" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "P0ARequirementOutcome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0ARequirementOutcome_passId_fkey" FOREIGN KEY ("passId") REFERENCES "P0AExtractionPass"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0ARequirementOutcome_reportedAssertionId_fkey" FOREIGN KEY ("reportedAssertionId") REFERENCES "P0AFactAssertion"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "P0ARequirementOutcome_reportedAssertionId_key" ON "P0ARequirementOutcome"("reportedAssertionId");
CREATE UNIQUE INDEX "P0ARequirementOutcome_passId_requirementId_key" ON "P0ARequirementOutcome"("passId", "requirementId");
CREATE INDEX "P0ARequirementOutcome_passId_state_idx" ON "P0ARequirementOutcome"("passId", "state");

CREATE TABLE "P0AFactEvidence" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "pageId" TEXT,
  "evidenceHash" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "printedPageLabel" TEXT,
  "statement" TEXT NOT NULL,
  "tableName" TEXT,
  "rowLabel" TEXT NOT NULL,
  "columnLabel" TEXT NOT NULL,
  "rawValue" TEXT NOT NULL,
  "snippet" TEXT NOT NULL,
  "snippetHash" TEXT NOT NULL,
  "locatorHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "P0AFactEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0AFactEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0AFactEvidence_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "P0ADocumentPage"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "P0AFactEvidence_page_number_check" CHECK ("pageNumber" > 0)
);

CREATE UNIQUE INDEX "P0AFactEvidence_evidenceHash_key" ON "P0AFactEvidence"("evidenceHash");
CREATE INDEX "P0AFactEvidence_documentId_pageNumber_idx" ON "P0AFactEvidence"("documentId", "pageNumber");
CREATE INDEX "P0AFactEvidence_snippetHash_idx" ON "P0AFactEvidence"("snippetHash");

CREATE TABLE "P0AFactAssertionEvidence" (
  "assertionId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  CONSTRAINT "P0AFactAssertionEvidence_pkey" PRIMARY KEY ("assertionId", "evidenceId"),
  CONSTRAINT "P0AFactAssertionEvidence_assertionId_fkey" FOREIGN KEY ("assertionId") REFERENCES "P0AFactAssertion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0AFactAssertionEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "P0AFactEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "P0AFactAssertionEvidence_assertionId_ordinal_key" ON "P0AFactAssertionEvidence"("assertionId", "ordinal");
CREATE INDEX "P0AFactAssertionEvidence_evidenceId_idx" ON "P0AFactAssertionEvidence"("evidenceId");
