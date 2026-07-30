import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_JOB_LEASE_POLICY,
  assertValidJobLeasePolicy,
  type JobClaim,
  type JobLeasePolicy,
  type JobStatus,
} from "@/lib/platform/jobs/job-types";

type ClaimedJobRow = {
  id: string;
  attemptCount: number;
  claimToken: string;
  leaseExpiresAt: Date;
  previousStatus: JobStatus;
};

type ExhaustedJobRow = {
  id: string;
  previousStatus: JobStatus;
};

export class LostJobLeaseError extends Error {
  constructor(jobId: string) {
    super(`Job lease is no longer owned for ${jobId}.`);
    this.name = "LostJobLeaseError";
  }
}

export async function claimNextJob(
  workerId: string,
  policy: JobLeasePolicy = DEFAULT_JOB_LEASE_POLICY,
): Promise<JobClaim | null> {
  if (!workerId.trim()) throw new Error("workerId is required.");
  assertValidJobLeasePolicy(policy);

  const claimToken = randomUUID();
  return prisma.$transaction(async (tx) => {
    const exhaustedJobs = await tx.$queryRawUnsafe<ExhaustedJobRow[]>(
      `WITH exhausted AS (
         SELECT "id", "status" AS "previousStatus"
         FROM "Job"
         WHERE "attemptCount" >= "maxAttempts"
           AND (
             "status" = 'RETRY_WAIT'
             OR (
               "status" IN ('CLAIMED','RUNNING')
               AND "leaseExpiresAt" < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second')
             )
           )
         FOR UPDATE SKIP LOCKED
       ), failed AS (
         UPDATE "Job" AS job
         SET "status"='FAILED',
             "completedAt"=CURRENT_TIMESTAMP,
             "claimedBy"=NULL,
             "claimToken"=NULL,
             "claimedAt"=NULL,
             "leaseExpiresAt"=NULL,
             "errorCode"='MAX_ATTEMPTS_EXHAUSTED',
             "errorMessage"=COALESCE(job."errorMessage", 'Maximum job attempts exhausted.'),
             "updatedAt"=CURRENT_TIMESTAMP
         FROM exhausted
         WHERE job."id"=exhausted."id"
         RETURNING job."id", exhausted."previousStatus"
       )
       SELECT * FROM failed`,
      policy.reclaimGraceSeconds,
    );

    for (const exhausted of exhaustedJobs) {
      if (exhausted.previousStatus === "CLAIMED" || exhausted.previousStatus === "RUNNING") {
        await tx.$executeRawUnsafe(
          `UPDATE "JobAttempt"
           SET "status"='LEASE_EXPIRED',
               "finishedAt"=COALESCE("finishedAt", CURRENT_TIMESTAMP),
               "durationMs"=COALESCE("durationMs", GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "startedAt")) * 1000)::INTEGER)),
               "errorCode"=COALESCE("errorCode", 'MAX_ATTEMPTS_EXHAUSTED'),
               "errorMessage"=COALESCE("errorMessage", 'Lease expired on the final permitted attempt.')
           WHERE "jobId"=$1 AND "finishedAt" IS NULL`,
          exhausted.id,
        );
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO "JobEvent" ("id","jobId","eventType","fromStatus","toStatus","stage","message")
         VALUES ($1,$2,'MAX_ATTEMPTS_EXHAUSTED',$3,'FAILED','FINALIZE','Maximum job attempts exhausted')`,
        randomUUID(),
        exhausted.id,
        exhausted.previousStatus,
      );
    }

    const rows = await tx.$queryRawUnsafe<ClaimedJobRow[]>(
      `WITH candidate AS (
         SELECT "id", "status" AS "previousStatus"
         FROM "Job"
         WHERE (
           ("status" IN ('QUEUED','RETRY_WAIT') AND "availableAt" <= CURRENT_TIMESTAMP)
           OR (
             "status" IN ('CLAIMED','RUNNING')
             AND "leaseExpiresAt" < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second')
           )
         )
         AND "attemptCount" < "maxAttempts"
         ORDER BY "priority" ASC, "availableAt" ASC, "createdAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       ), claimed AS (
         UPDATE "Job" AS job
         SET "status" = 'CLAIMED',
             "claimedBy" = $2,
             "claimToken" = $3,
             "claimedAt" = CURRENT_TIMESTAMP,
             "lastHeartbeatAt" = CURRENT_TIMESTAMP,
             "leaseExpiresAt" = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
             "attemptCount" = job."attemptCount" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
         FROM candidate
         WHERE job."id" = candidate."id"
         RETURNING job."id", job."attemptCount", job."claimToken", job."leaseExpiresAt", candidate."previousStatus"
       )
       SELECT * FROM claimed`,
      policy.reclaimGraceSeconds,
      workerId,
      claimToken,
      policy.leaseSeconds,
    );

    const claimed = rows[0];
    if (!claimed) return null;

    if (claimed.previousStatus === "CLAIMED" || claimed.previousStatus === "RUNNING") {
      await tx.$executeRawUnsafe(
        `UPDATE "JobAttempt"
         SET "status"='LEASE_EXPIRED',
             "finishedAt"=COALESCE("finishedAt", CURRENT_TIMESTAMP),
             "durationMs"=COALESCE("durationMs", GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "startedAt")) * 1000)::INTEGER))
         WHERE "jobId"=$1 AND "finishedAt" IS NULL`,
        claimed.id,
      );
    }

    const attemptId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "JobAttempt" (
         "id","jobId","attemptNumber","workerId","claimToken","status"
       ) VALUES ($1,$2,$3,$4,$5,'CLAIMED')`,
      attemptId,
      claimed.id,
      claimed.attemptCount,
      workerId,
      claimToken,
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO "JobEvent" (
         "id","jobId","attemptId","eventType","fromStatus","toStatus","stage","message"
       ) VALUES ($1,$2,$3,'CLAIMED',$4,'CLAIMED','CLAIM','Worker claimed job')`,
      randomUUID(),
      claimed.id,
      attemptId,
      claimed.previousStatus,
    );

    return {
      jobId: claimed.id,
      claimToken,
      workerId,
      leaseExpiresAt: claimed.leaseExpiresAt,
      attemptNumber: claimed.attemptCount,
    };
  });
}

export async function markJobRunning(claim: JobClaim): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.$executeRawUnsafe(
      `UPDATE "Job"
       SET "status"='RUNNING', "updatedAt"=CURRENT_TIMESTAMP
       WHERE "id"=$1 AND "claimToken"=$2 AND "claimedBy"=$3
         AND "status"='CLAIMED' AND "leaseExpiresAt" > CURRENT_TIMESTAMP`,
      claim.jobId,
      claim.claimToken,
      claim.workerId,
    );
    if (changed !== 1) throw new LostJobLeaseError(claim.jobId);

    await tx.$executeRawUnsafe(
      `UPDATE "JobAttempt"
       SET "status"='RUNNING'
       WHERE "jobId"=$1 AND "attemptNumber"=$2 AND "claimToken"=$3`,
      claim.jobId,
      claim.attemptNumber,
      claim.claimToken,
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO "JobEvent" ("id","jobId","eventType","fromStatus","toStatus","stage","message")
       VALUES ($1,$2,'RUNNING','CLAIMED','RUNNING','EXECUTION','Worker started job')`,
      randomUUID(),
      claim.jobId,
    );
  });
}

export async function heartbeatJob(
  claim: JobClaim,
  policy: JobLeasePolicy = DEFAULT_JOB_LEASE_POLICY,
): Promise<Date> {
  assertValidJobLeasePolicy(policy);
  const rows = await prisma.$queryRawUnsafe<Array<{ leaseExpiresAt: Date }>>(
    `UPDATE "Job"
     SET "lastHeartbeatAt"=CURRENT_TIMESTAMP,
         "leaseExpiresAt"=CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
         "updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1 AND "claimToken"=$2 AND "claimedBy"=$3
       AND "status" IN ('CLAIMED','RUNNING')
       AND "leaseExpiresAt" > CURRENT_TIMESTAMP
     RETURNING "leaseExpiresAt"`,
    claim.jobId,
    claim.claimToken,
    claim.workerId,
    policy.leaseSeconds,
  );
  if (!rows[0]) throw new LostJobLeaseError(claim.jobId);
  return rows[0].leaseExpiresAt;
}

export async function finishJob(
  claim: JobClaim,
  status: Extract<JobStatus, "SUCCEEDED" | "NEEDS_INPUT" | "FAILED" | "CANCELLED">,
  detail: { errorCode?: string; errorMessage?: string; providerResponseId?: string } = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const terminal = status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
    const changed = await tx.$executeRawUnsafe(
      `UPDATE "Job"
       SET "status"=$4,
           "providerResponseId"=COALESCE($5,"providerResponseId"),
           "errorCode"=$6,
           "errorMessage"=$7,
           "completedAt"=CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE NULL END,
           "claimedBy"=NULL,
           "claimToken"=NULL,
           "claimedAt"=NULL,
           "leaseExpiresAt"=NULL,
           "lastHeartbeatAt"=CURRENT_TIMESTAMP,
           "updatedAt"=CURRENT_TIMESTAMP
       WHERE "id"=$1 AND "claimToken"=$2 AND "claimedBy"=$3
         AND "status" IN ('CLAIMED','RUNNING')
         AND "leaseExpiresAt" > CURRENT_TIMESTAMP`,
      claim.jobId,
      claim.claimToken,
      claim.workerId,
      status,
      detail.providerResponseId ?? null,
      detail.errorCode ?? null,
      detail.errorMessage?.slice(0, 2000) ?? null,
      terminal,
    );
    if (changed !== 1) throw new LostJobLeaseError(claim.jobId);

    const attemptStatus = status === "NEEDS_INPUT" ? "SUCCEEDED" : status;
    await tx.$executeRawUnsafe(
      `UPDATE "JobAttempt"
       SET "status"=$4,
           "finishedAt"=CURRENT_TIMESTAMP,
           "durationMs"=GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "startedAt")) * 1000)::INTEGER),
           "providerResponseId"=COALESCE($5,"providerResponseId"),
           "errorCode"=$6,
           "errorMessage"=$7
       WHERE "jobId"=$1 AND "attemptNumber"=$2 AND "claimToken"=$3`,
      claim.jobId,
      claim.attemptNumber,
      claim.claimToken,
      attemptStatus,
      detail.providerResponseId ?? null,
      detail.errorCode ?? null,
      detail.errorMessage?.slice(0, 2000) ?? null,
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO "JobEvent" ("id","jobId","eventType","fromStatus","toStatus","stage","message")
       VALUES ($1,$2,$3,'RUNNING',$4,'FINALIZE',$5)`,
      randomUUID(),
      claim.jobId,
      status,
      status,
      detail.errorMessage?.slice(0, 500) ?? `Job finished as ${status}`,
    );
  });
}

export async function scheduleJobRetry(
  claim: JobClaim,
  delaySeconds: number,
  detail: { errorCode?: string; errorMessage?: string } = {},
): Promise<void> {
  if (!Number.isInteger(delaySeconds) || delaySeconds <= 0) {
    throw new Error("delaySeconds must be a positive integer.");
  }

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ status: JobStatus }>>(
      `UPDATE "Job"
       SET "status"=CASE WHEN "attemptCount" >= "maxAttempts" THEN 'FAILED' ELSE 'RETRY_WAIT' END,
           "availableAt"=CASE WHEN "attemptCount" >= "maxAttempts" THEN "availableAt" ELSE CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second') END,
           "completedAt"=CASE WHEN "attemptCount" >= "maxAttempts" THEN CURRENT_TIMESTAMP ELSE NULL END,
           "errorCode"=CASE WHEN "attemptCount" >= "maxAttempts" THEN 'MAX_ATTEMPTS_EXHAUSTED' ELSE $5 END,
           "errorMessage"=CASE WHEN "attemptCount" >= "maxAttempts" THEN COALESCE($6, 'Maximum job attempts exhausted.') ELSE $6 END,
           "claimedBy"=NULL,
           "claimToken"=NULL,
           "claimedAt"=NULL,
           "leaseExpiresAt"=NULL,
           "updatedAt"=CURRENT_TIMESTAMP
       WHERE "id"=$1 AND "claimToken"=$2 AND "claimedBy"=$3
         AND "status" IN ('CLAIMED','RUNNING')
         AND "leaseExpiresAt" > CURRENT_TIMESTAMP
       RETURNING "status"`,
      claim.jobId,
      claim.claimToken,
      claim.workerId,
      delaySeconds,
      detail.errorCode ?? null,
      detail.errorMessage?.slice(0, 2000) ?? null,
    );
    const nextStatus = rows[0]?.status;
    if (!nextStatus) throw new LostJobLeaseError(claim.jobId);

    await tx.$executeRawUnsafe(
      `UPDATE "JobAttempt"
       SET "status"='FAILED', "finishedAt"=CURRENT_TIMESTAMP,
           "durationMs"=GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "startedAt")) * 1000)::INTEGER),
           "errorCode"=$4, "errorMessage"=$5
       WHERE "jobId"=$1 AND "attemptNumber"=$2 AND "claimToken"=$3`,
      claim.jobId,
      claim.attemptNumber,
      claim.claimToken,
      nextStatus === "FAILED" ? "MAX_ATTEMPTS_EXHAUSTED" : detail.errorCode ?? null,
      detail.errorMessage?.slice(0, 2000) ??
        (nextStatus === "FAILED" ? "Maximum job attempts exhausted." : null),
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO "JobEvent" ("id","jobId","eventType","fromStatus","toStatus","stage","message","metadata")
       VALUES ($1,$2,$3,'RUNNING',$4,$5,$6,$7::jsonb)`,
      randomUUID(),
      claim.jobId,
      nextStatus === "FAILED" ? "MAX_ATTEMPTS_EXHAUSTED" : "RETRY_SCHEDULED",
      nextStatus,
      nextStatus === "FAILED" ? "FINALIZE" : "RETRY",
      detail.errorMessage?.slice(0, 500) ??
        (nextStatus === "FAILED" ? "Maximum job attempts exhausted" : "Retry scheduled"),
      JSON.stringify(nextStatus === "FAILED" ? { attemptNumber: claim.attemptNumber } : { delaySeconds }),
    );
  });
}
