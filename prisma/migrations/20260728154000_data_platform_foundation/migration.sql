-- InvestAI Data Platform v1 — PR A additive foundation
-- This migration does not remove or rewrite the legacy PDF upload tables.

CREATE TABLE "UploadSession" (
  "id" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "uploadMode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INITIATED',
  "storageProvider" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "providerUploadId" TEXT,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "expectedSize" INTEGER NOT NULL,
  "partSize" INTEGER,
  "resumeTokenHash" TEXT NOT NULL,
  "lastPartNumber" INTEGER,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UploadSession_mode_check" CHECK ("uploadMode" IN ('SINGLE_PUT','MULTIPART')),
  CONSTRAINT "UploadSession_status_check" CHECK ("status" IN ('INITIATED','UPLOADING','UPLOADED','VERIFYING','VERIFIED','ABORTED','FAILED')),
  CONSTRAINT "UploadSession_size_check" CHECK ("expectedSize" > 0),
  CONSTRAINT "UploadSession_part_size_check" CHECK (
    ("uploadMode" = 'SINGLE_PUT' AND "partSize" IS NULL)
    OR ("uploadMode" = 'MULTIPART' AND "partSize" IS NOT NULL AND "partSize" >= 5242880)
  )
);

CREATE UNIQUE INDEX "UploadSession_correlationId_key" ON "UploadSession"("correlationId");
CREATE UNIQUE INDEX "UploadSession_objectKey_key" ON "UploadSession"("objectKey");
CREATE INDEX "UploadSession_status_expiresAt_idx" ON "UploadSession"("status", "expiresAt");

CREATE TABLE "UploadPart" (
  "id" TEXT NOT NULL,
  "uploadSessionId" TEXT NOT NULL,
  "partNumber" INTEGER NOT NULL,
  "etag" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadPart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UploadPart_uploadSessionId_fkey" FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UploadPart_number_check" CHECK ("partNumber" > 0),
  CONSTRAINT "UploadPart_size_check" CHECK ("size" > 0)
);

CREATE UNIQUE INDEX "UploadPart_uploadSessionId_partNumber_key" ON "UploadPart"("uploadSessionId", "partNumber");
CREATE INDEX "UploadPart_uploadSessionId_completedAt_idx" ON "UploadPart"("uploadSessionId", "completedAt");

CREATE TABLE "FinancialDocument" (
  "id" TEXT NOT NULL,
  "uploadSessionId" TEXT,
  "storageProvider" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "verifiedSize" INTEGER NOT NULL,
  "sha256" TEXT,
  "magicBytesVerified" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'UPLOADED',
  "uploadedBy" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialDocument_uploadSessionId_fkey" FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FinancialDocument_status_check" CHECK ("status" IN ('UPLOADED','VERIFYING','VERIFIED','DUPLICATE','CORRUPT','FAILED','DELETED')),
  CONSTRAINT "FinancialDocument_size_check" CHECK ("verifiedSize" > 0)
);

CREATE UNIQUE INDEX "FinancialDocument_uploadSessionId_key" ON "FinancialDocument"("uploadSessionId");
CREATE UNIQUE INDEX "FinancialDocument_objectKey_key" ON "FinancialDocument"("objectKey");
CREATE INDEX "FinancialDocument_sha256_idx" ON "FinancialDocument"("sha256");
CREATE INDEX "FinancialDocument_status_createdAt_idx" ON "FinancialDocument"("status", "createdAt");

CREATE TABLE "Job" (
  "id" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "payload" JSONB NOT NULL,
  "deduplicationKey" TEXT,
  "documentId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedBy" TEXT,
  "claimToken" TEXT,
  "claimedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "providerResponseId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Job_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Job_status_check" CHECK ("status" IN ('QUEUED','CLAIMED','RUNNING','RETRY_WAIT','NEEDS_INPUT','SUCCEEDED','FAILED','CANCELLED')),
  CONSTRAINT "Job_attempt_check" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0),
  CONSTRAINT "Job_priority_check" CHECK ("priority" >= 0)
);

CREATE INDEX "Job_correlationId_idx" ON "Job"("correlationId");
CREATE INDEX "Job_claim_idx" ON "Job"("status", "availableAt", "priority", "createdAt");
CREATE INDEX "Job_lease_idx" ON "Job"("status", "leaseExpiresAt");
CREATE INDEX "Job_documentId_idx" ON "Job"("documentId");
CREATE UNIQUE INDEX "Job_active_deduplicationKey_key"
  ON "Job"("deduplicationKey")
  WHERE "deduplicationKey" IS NOT NULL
    AND "status" IN ('QUEUED','CLAIMED','RUNNING','RETRY_WAIT','NEEDS_INPUT');

CREATE TABLE "JobAttempt" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "workerId" TEXT,
  "claimToken" TEXT,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "providerRequestId" TEXT,
  "providerResponseId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobAttempt_number_check" CHECK ("attemptNumber" > 0),
  CONSTRAINT "JobAttempt_status_check" CHECK ("status" IN ('CLAIMED','RUNNING','SUCCEEDED','FAILED','LEASE_EXPIRED','CANCELLED')),
  CONSTRAINT "JobAttempt_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);

CREATE UNIQUE INDEX "JobAttempt_jobId_attemptNumber_key" ON "JobAttempt"("jobId", "attemptNumber");
CREATE INDEX "JobAttempt_jobId_startedAt_idx" ON "JobAttempt"("jobId", "startedAt");

CREATE TABLE "JobEvent" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "attemptId" TEXT,
  "eventType" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "stage" TEXT,
  "message" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "JobAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "JobEvent_jobId_createdAt_idx" ON "JobEvent"("jobId", "createdAt");
CREATE INDEX "JobEvent_attemptId_idx" ON "JobEvent"("attemptId");

CREATE TABLE "MetadataAssertion" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "proposedValue" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION,
  "sourcePage" INTEGER,
  "sourceText" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetadataAssertion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetadataAssertion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetadataAssertion_status_check" CHECK ("status" IN ('PROPOSED','CONFIRMED','REJECTED')),
  CONSTRAINT "MetadataAssertion_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "MetadataAssertion_page_check" CHECK ("sourcePage" IS NULL OR "sourcePage" > 0)
);

CREATE INDEX "MetadataAssertion_documentId_field_idx" ON "MetadataAssertion"("documentId", "field");
CREATE INDEX "MetadataAssertion_status_idx" ON "MetadataAssertion"("status");
