-- Phase 6A additive P0-B historical facts and reproducible derived metrics.
-- Existing P0-A and legacy tables are not rewritten.

CREATE TABLE "P0BExtractionRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "reportRevisionId" TEXT NOT NULL,
  "manifestVersion" TEXT NOT NULL,
  "extractorVersion" TEXT NOT NULL,
  "formulaRegistryVersion" TEXT NOT NULL,
  "completeIdentityHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerCalls" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "P0BExtractionRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0BExtractionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0BExtractionRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0BExtractionRun_reportRevisionId_fkey" FOREIGN KEY ("reportRevisionId") REFERENCES "P0AReportRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0BExtractionRun_zero_provider_check" CHECK ("providerCalls" >= 0 AND "inputTokens" >= 0 AND "outputTokens" >= 0 AND "estimatedCostUsd" >= 0)
);
CREATE UNIQUE INDEX "P0BExtractionRun_completeIdentityHash_key" ON "P0BExtractionRun"("completeIdentityHash");
CREATE INDEX "P0BExtractionRun_documentId_status_idx" ON "P0BExtractionRun"("documentId", "status");
CREATE INDEX "P0BExtractionRun_reportRevisionId_idx" ON "P0BExtractionRun"("reportRevisionId");

CREATE TABLE "DerivedMetricDefinition" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "formulaVersion" TEXT NOT NULL,
  "expression" TEXT NOT NULL,
  "namedInputs" JSONB NOT NULL,
  "inclusionRules" JSONB NOT NULL,
  "exclusionRules" JSONB NOT NULL,
  "compatibilityRules" JSONB NOT NULL,
  "outputUnit" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DerivedMetricDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DerivedMetricDefinition_code_formulaVersion_key" ON "DerivedMetricDefinition"("code", "formulaVersion");

CREATE TABLE "DerivedMetricResult" (
  "id" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "periodType" TEXT NOT NULL,
  "consolidationScope" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "unitType" TEXT NOT NULL,
  "scale" DECIMAL(38,6) NOT NULL,
  "decimalValue" DECIMAL(38,6) NOT NULL,
  "calculationTimestamp" TIMESTAMP(3) NOT NULL,
  "calculationRunIdentity" TEXT NOT NULL,
  "engine" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "validationStatus" TEXT NOT NULL,
  "resultHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DerivedMetricResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DerivedMetricResult_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "DerivedMetricDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DerivedMetricResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "P0BExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DerivedMetricResult_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DerivedMetricResult_resultHash_key" ON "DerivedMetricResult"("resultHash");
CREATE UNIQUE INDEX "DerivedMetricResult_runId_definitionId_key" ON "DerivedMetricResult"("runId", "definitionId");
CREATE INDEX "DerivedMetricResult_companyId_periodEnd_idx" ON "DerivedMetricResult"("companyId", "periodEnd");

CREATE TABLE "DerivedMetricInput" (
  "resultId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "inputRole" TEXT NOT NULL,
  "inputIdentity" TEXT NOT NULL,
  "inputAssertionId" TEXT,
  "inputResultId" TEXT,
  "inputValue" DECIMAL(38,6) NOT NULL,
  "inputExtractionOrigin" TEXT,
  "inputEvidenceHashes" JSONB NOT NULL,
  "revisionContextHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DerivedMetricInput_pkey" PRIMARY KEY ("resultId", "ordinal"),
  CONSTRAINT "DerivedMetricInput_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "DerivedMetricResult"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DerivedMetricInput_inputAssertionId_fkey" FOREIGN KEY ("inputAssertionId") REFERENCES "P0AFactAssertion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DerivedMetricInput_inputResultId_fkey" FOREIGN KEY ("inputResultId") REFERENCES "DerivedMetricResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DerivedMetricInput_at_most_one_fk_check" CHECK (NOT ("inputAssertionId" IS NOT NULL AND "inputResultId" IS NOT NULL))
);
CREATE INDEX "DerivedMetricInput_inputAssertionId_idx" ON "DerivedMetricInput"("inputAssertionId");
CREATE INDEX "DerivedMetricInput_inputResultId_idx" ON "DerivedMetricInput"("inputResultId");
CREATE INDEX "DerivedMetricInput_inputIdentity_idx" ON "DerivedMetricInput"("inputIdentity");

CREATE TABLE "P0BRequirementOutcome" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "applicability" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "extractionOrigin" TEXT,
  "reportedAssertionId" TEXT,
  "derivedResultId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "P0BRequirementOutcome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "P0BRequirementOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "P0BExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "P0BRequirementOutcome_reportedAssertionId_fkey" FOREIGN KEY ("reportedAssertionId") REFERENCES "P0AFactAssertion"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "P0BRequirementOutcome_derivedResultId_fkey" FOREIGN KEY ("derivedResultId") REFERENCES "DerivedMetricResult"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "P0BRequirementOutcome_family_target_check" CHECK (("family" = 'REPORTED' AND "derivedResultId" IS NULL) OR ("family" = 'CALCULATED' AND "reportedAssertionId" IS NULL))
);
CREATE UNIQUE INDEX "P0BRequirementOutcome_runId_requirementId_key" ON "P0BRequirementOutcome"("runId", "requirementId");
CREATE UNIQUE INDEX "P0BRequirementOutcome_reportedAssertionId_key" ON "P0BRequirementOutcome"("reportedAssertionId");
CREATE UNIQUE INDEX "P0BRequirementOutcome_derivedResultId_key" ON "P0BRequirementOutcome"("derivedResultId");
CREATE INDEX "P0BRequirementOutcome_runId_state_idx" ON "P0BRequirementOutcome"("runId", "state");
