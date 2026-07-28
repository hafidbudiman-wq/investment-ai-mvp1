import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_JOB_LEASE_POLICY,
  type JobClaim,
  type JobLeasePolicy,
  type JobStatus,
} from "@/lib/platform/jobs/job-types";

type ClaimedJobRow = {
  id: string;
  attemptCount: number;
  claimToken: string;
  leaseExpiresAt: Date;
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
  const claimToken = randomUUID();
  const rows = await prisma.$queryRawUnsafe<ClaimedJobRow[]>(
    `WITH candidate AS (
       SELECT "id"
       FROM "Job"
       WHERE (
         ("status" = 'QUEUED' AND "availableAt" <= CURRENT_TIMESTAMP)
         OR (
           "status" IN ('CLAIMED','RUNNING')
           AND "leaseExpiresAt" < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second')
         )
       )
       AND "attemptCount" < "maxAttempts"
       ORDER BY "priority" ASC, "availableAt" ASC, "createdAt" ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
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
     RETURNING job."id", job."attemptCount", job."claimToken", job."leaseExpiresAt"`,
    policy.reclaimGraceSeconds,
    workerId,
    claimToken,
    policy.leaseSeconds,
  );

  const claimed = rows[0];
  if (!claimed) return null;

  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `INSERT INTO "JobAttempt" (
         "id","jobId","attemptNumber","workerId","claimToken","status"
       ) VALUES ($1,$2,$3,$4,$5,'CLAIMED')`,
      randomUUID(),
      claimed.id,
      claimed.attemptCount,
      workerId,
      claimToken,
    ),
    prisma.$executeRawUnsafe(
      `INSERT INTO "JobEvent" (
         "id","jobId","eventType","fromStatus","toStatus","stage","message"
       ) VALUES ($1,$2,'CLAIMED',NULL,'CLAIMED','CLAIM','Worker claimed job')`,
      randomUUID(),
      claimed.id,
    ),
  ]);

  return {
    jobId: claimed.id,
    claimToken,
    workerId,
    leaseExpiresAt: claimed.leaseExpiresAt,
    attemptNumber: claimed.attemptCount,
  };
}

export async function markJobRunning(claim: JobClaim): Promise<void> {
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "Job"
     SET "status"='RUNNING', "updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1 AND "claimToken"=$2 AND "claimedBy"=$3
       AND "status"='CLAIMED' AND "leaseExpiresAt" > CURRENT_TIMESTAMP`,
    claim.jobId,
    claim.claimToken,
    claim.workerId,
  );
  if (changed !== 1) throw new LostJobLeaseError(claim.jobId);

  await prisma.$executeRawUnsafe(
    `UPDATE "JobAttempt"
     SET "status"='RUNNING'
     WHERE "jobId"=$1 AND "attemptNumber"=$2 AND "claimToken"=$3`,
    claim.jobId,
    claim.attemptNumber,
    claim.claimToken,
  );
}

export async function heartbeatJob(
  claim: JobClaim,
  policy: JobLeasePolicy = DEFAULT_JOB_LEASE_POLICY,
): Promise<Date> {
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
  const terminal = status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "Job"
     SET "status"=$4,
         "providerResponseId"=COALESCE($5,"providerResponseId"),
         "errorCode"=$6,
         "errorMessage"=$7,
         "completedAt"=CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE NULL END,
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

  await prisma.$executeRawUnsafe(
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
    status === "NEEDS_INPUT" ? "SUCCEEDED" : status,
    detail.providerResponseId ?? null,
    detail.errorCode ?? null,
    detail.errorMessage?.slice(0, 2000) ?? null,
  );
}

export async function scheduleJobRetry(
  claim: JobClaim,
  delaySeconds: number,
  detail: { errorCode?: string; errorMessage?: string } = {},
): Promise<void> {
  if (!Number.isInteger(delaySeconds) || delaySeconds <= 0) {
    throw new Error("delaySeconds must be a positive integer.");
  }

  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "Job"
     SET "status"='RETRY_WAIT',
         "availableAt"=CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
         "errorCode"=$5,
         "errorMessage"=$6,
         "leaseExpiresAt"=NULL,
         "updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1 AND "claimToken"=$2 AND "claimedBy"=$3
       AND "status" IN ('CLAIMED','RUNNING')
       AND "leaseExpiresAt" > CURRENT_TIMESTAMP`,
    claim.jobId,
    claim.claimToken,
    claim.workerId,
    delaySeconds,
    detail.errorCode ?? null,
    detail.errorMessage?.slice(0, 2000) ?? null,
  );
  if (changed !== 1) throw new LostJobLeaseError(claim.jobId);

  await prisma.$executeRawUnsafe(
    `UPDATE "JobAttempt"
     SET "status"='FAILED', "finishedAt"=CURRENT_TIMESTAMP,
         "durationMs"=GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "startedAt")) * 1000)::INTEGER),
         "errorCode"=$4, "errorMessage"=$5
     WHERE "jobId"=$1 AND "attemptNumber"=$2 AND "claimToken"=$3`,
    claim.jobId,
    claim.attemptNumber,
    claim.claimToken,
    detail.errorCode ?? null,
    detail.errorMessage?.slice(0, 2000) ?? null,
  );
}
