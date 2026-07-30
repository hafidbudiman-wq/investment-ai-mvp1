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

export function assertValidJobLeasePolicy(policy: JobLeasePolicy): void {
  if (!Number.isInteger(policy.leaseSeconds) || policy.leaseSeconds <= 0) {
    throw new Error("leaseSeconds must be a positive integer.");
  }
  if (!Number.isInteger(policy.heartbeatSeconds) || policy.heartbeatSeconds <= 0) {
    throw new Error("heartbeatSeconds must be a positive integer.");
  }
  if (policy.heartbeatSeconds >= policy.leaseSeconds) {
    throw new Error("heartbeatSeconds must be shorter than leaseSeconds.");
  }
  if (!Number.isInteger(policy.reclaimGraceSeconds) || policy.reclaimGraceSeconds < 0) {
    throw new Error("reclaimGraceSeconds must be a non-negative integer.");
  }
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts <= 0) {
    throw new Error("maxAttempts must be a positive integer.");
  }
  if (policy.retryBackoffSeconds.length < Math.max(0, policy.maxAttempts - 1)) {
    throw new Error("retryBackoffSeconds must cover every retry before maxAttempts.");
  }
  if (policy.retryBackoffSeconds.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error("retry backoff values must be positive integers.");
  }
}

assertValidJobLeasePolicy(DEFAULT_JOB_LEASE_POLICY);

export const ALLOWED_JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  QUEUED: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["RUNNING", "RETRY_WAIT", "FAILED", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "RETRY_WAIT", "NEEDS_INPUT", "FAILED", "CANCELLED"],
  RETRY_WAIT: ["QUEUED", "CANCELLED"],
  NEEDS_INPUT: ["QUEUED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: ["QUEUED"],
  CANCELLED: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_JOB_TRANSITIONS[from].includes(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(`Invalid job transition: ${from} -> ${to}`);
  }
}

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
