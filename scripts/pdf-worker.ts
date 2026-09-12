import { randomUUID } from "node:crypto";
import { kickQueuedAsyncExtractionJobs, pollAsyncExtractionJobs, reclassifyPendingExtractionRuns } from "../lib/async-pdf-extraction";
import { backfillVerifiedFundamentalFacts } from "../lib/financial/fundamental-backfill";
import { prisma } from "../lib/prisma";
import { getPlatformFeatureFlags } from "../lib/platform/feature-flags";
import { runP0AShadowJobCycle } from "../lib/financial/p0a/job-worker";

const pollIntervalMs = Math.max(1_000, Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000));
const workerId = process.env.WORKER_ID?.trim() || `pdf-worker-${randomUUID()}`;
let stopping = false;

export async function runWorkerCycle(): Promise<void> {
  const flags = getPlatformFeatureFlags();
  const backfills = await backfillVerifiedFundamentalFacts();
  for (const result of backfills) {
    if (result.status === "APPLIED") console.info(JSON.stringify({ event: "fundamental_backfill_applied", ...result }));
  }
  await reclassifyPendingExtractionRuns(10);
  await kickQueuedAsyncExtractionJobs(5);
  await pollAsyncExtractionJobs(10);
  if (flags.investaiP0AShadow) await runP0AShadowJobCycle(workerId);
}

async function main() {
  console.info(JSON.stringify({ event: "worker_started", workerId, pollIntervalMs }));
  while (!stopping) {
    try {
      await runWorkerCycle();
    } catch (error) {
      console.error("pdf-worker-cycle-failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; });

if (import.meta.url === `file://${process.argv[1]}`) void main();
