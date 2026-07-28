export const JOB_TYPES = [
  "DOCUMENT_VERIFY",
  "FINANCIAL_METADATA_DETECT",
  "FINANCIAL_EXTRACT",
  "OPENAI_RESPONSE_POLL",
  "ABANDONED_UPLOAD_CLEANUP",
  "DERIVED_METRIC_CALCULATE",
  "VALUATION_CALCULATE",
  "RAG_INDEX",
  "KNOWLEDGE_GRAPH_SYNC",
  "AI_THESIS_GENERATE",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "RETRY_WAIT",
  "NEEDS_INPUT",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobLeasePolicy = {
  leaseSeconds: number;
  heartbeatSeconds: number;
  reclaimGraceSeconds: number;
  maxAttempts: number;
  retryBackoffSeconds: readonly number[];
};

export const DEFAULT_JOB_LEASE_POLICY: JobLeasePolicy = {
  leaseSeconds: 120,
  heartbeatSeconds: 30,
  reclaimGraceSeconds: 30,
  maxAttempts: 3,
  retryBackoffSeconds: [30, 120, 600],
};

export type JobClaim = {
  jobId: string;
  claimToken: string;
  workerId: string;
  leaseExpiresAt: Date;
  attemptNumber: number;
};

export type RetryClassification =
  | "TRANSIENT"
  | "PERMANENT"
  | "NEEDS_INPUT"
  | "UNSUPPORTED";
