import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import {
  LostJobLeaseError,
  claimNextJob,
  finishJob,
  markJobRunning,
  scheduleJobRetry,
} from "../../lib/platform/jobs/job-repository";

async function insertJob(input: { availableAt?: Date; maxAttempts?: number } = {}) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Job" (
       "id","correlationId","type","status","priority","payload",
       "attemptCount","maxAttempts","availableAt","createdAt","updatedAt"
     ) VALUES ($1,$2,'DOCUMENT_VERIFY','QUEUED',100,'{}'::jsonb,0,$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id,
    randomUUID(),
    input.maxAttempts ?? 3,
    input.availableAt ?? new Date(),
  );
  return id;
}

async function main() {
  await prisma.jobEvent.deleteMany();
  await prisma.jobAttempt.deleteMany();
  await prisma.job.deleteMany();

  const firstJobId = await insertJob();
  const [claimA, claimB] = await Promise.all([
    claimNextJob("worker-a"),
    claimNextJob("worker-b"),
  ]);
  const claims = [claimA, claimB].filter(Boolean);
  assert.equal(claims.length, 1, "exactly one worker must win an atomic claim");
  assert.equal(claims[0]?.jobId, firstJobId);

  const winningClaim = claims[0]!;
  await markJobRunning(winningClaim);
  await finishJob(winningClaim, "SUCCEEDED");
  const completed = await prisma.job.findUniqueOrThrow({ where: { id: firstJobId } });
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.attemptCount, 1);

  const retryJobId = await insertJob();
  const firstRetryClaim = await claimNextJob("worker-retry-a");
  assert.equal(firstRetryClaim?.jobId, retryJobId);
  await markJobRunning(firstRetryClaim!);
  await scheduleJobRetry(firstRetryClaim!, 1, { errorCode: "TRANSIENT" });
  await prisma.job.update({
    where: { id: retryJobId },
    data: { availableAt: new Date(Date.now() - 1_000) },
  });

  const secondRetryClaim = await claimNextJob("worker-retry-b");
  assert.equal(secondRetryClaim?.jobId, retryJobId, "expired retry wait must be claimable");
  assert.equal(secondRetryClaim?.attemptNumber, 2);

  await assert.rejects(
    () => finishJob(firstRetryClaim!, "SUCCEEDED"),
    (error: unknown) => error instanceof LostJobLeaseError,
    "stale fencing token must not finish a reclaimed job",
  );

  await markJobRunning(secondRetryClaim!);
  await finishJob(secondRetryClaim!, "SUCCEEDED");

  const attempts = await prisma.jobAttempt.findMany({
    where: { jobId: retryJobId },
    orderBy: { attemptNumber: "asc" },
  });
  assert.deepEqual(
    attempts.map((attempt) => [attempt.attemptNumber, attempt.status]),
    [
      [1, "FAILED"],
      [2, "SUCCEEDED"],
    ],
  );

  const finalRetryJobId = await insertJob({ maxAttempts: 1 });
  const finalRetryClaim = await claimNextJob("worker-final-retry");
  assert.equal(finalRetryClaim?.jobId, finalRetryJobId);
  await markJobRunning(finalRetryClaim!);
  await scheduleJobRetry(finalRetryClaim!, 1, { errorCode: "TRANSIENT" });
  const finalRetryJob = await prisma.job.findUniqueOrThrow({ where: { id: finalRetryJobId } });
  assert.equal(finalRetryJob.status, "FAILED", "final attempt must not remain in RETRY_WAIT");
  assert.equal(finalRetryJob.errorCode, "MAX_ATTEMPTS_EXHAUSTED");
  assert.ok(finalRetryJob.completedAt);

  const expiredFinalJobId = await insertJob({ maxAttempts: 1 });
  const expiredFinalClaim = await claimNextJob("worker-final-expired");
  assert.equal(expiredFinalClaim?.jobId, expiredFinalJobId);
  await markJobRunning(expiredFinalClaim!);
  await prisma.job.update({
    where: { id: expiredFinalJobId },
    data: { leaseExpiresAt: new Date(Date.now() - 120_000) },
  });

  const noReclaim = await claimNextJob("worker-after-final-expiry", {
    leaseSeconds: 120,
    heartbeatSeconds: 30,
    reclaimGraceSeconds: 0,
    maxAttempts: 3,
    retryBackoffSeconds: [30, 120, 600],
  });
  assert.equal(noReclaim, null, "exhausted expired job must not be reclaimed");
  const expiredFinalJob = await prisma.job.findUniqueOrThrow({ where: { id: expiredFinalJobId } });
  assert.equal(expiredFinalJob.status, "FAILED");
  assert.equal(expiredFinalJob.errorCode, "MAX_ATTEMPTS_EXHAUSTED");
  const expiredAttempt = await prisma.jobAttempt.findFirstOrThrow({
    where: { jobId: expiredFinalJobId, attemptNumber: 1 },
  });
  assert.equal(expiredAttempt.status, "LEASE_EXPIRED");

  await assert.rejects(
    () => finishJob(expiredFinalClaim!, "SUCCEEDED"),
    (error: unknown) => error instanceof LostJobLeaseError,
    "expired final worker must remain fenced",
  );

  console.log("PostgreSQL job repository integration smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
