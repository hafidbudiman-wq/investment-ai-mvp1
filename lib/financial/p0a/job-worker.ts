import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { noProviderExtractor, type P0AExtractor } from "@/lib/financial/p0a/mock-extractor";
import { loadCachedP0APageIndex, persistP0AShadowResult } from "@/lib/financial/p0a/persistence";
import { runP0AShadowPipeline } from "@/lib/financial/p0a/pipeline";
import type { P0AIssuerContext } from "@/lib/financial/p0a/types";
import { P0A_PARSER_VERSION } from "@/lib/financial/p0a/versions";
import { prisma } from "@/lib/prisma";
import { claimNextJob, finishJob, markJobRunning, scheduleJobRetry } from "@/lib/platform/jobs/job-repository";

const payloadSchema = z.object({
  companyId: z.string().min(1),
  context: z.object({
    companyId: z.string().optional(), ticker: z.string().min(1),
    issuerType: z.enum(["LISTED_COMMON_EQUITY", "OTHER"]),
    accountingModel: z.enum(["NON_FINANCIAL", "BANK", "INSURANCE", "OTHER_FINANCIAL"]),
    sector: z.string().optional(), consolidated: z.boolean().nullable(), audited: z.boolean().nullable(),
    periodStart: z.string().date(), periodEnd: z.string().date(),
    periodType: z.enum(["Q1", "H1", "Q3", "FY", "MONTHLY"]),
    currency: z.string().min(1), documentScale: z.string().regex(/^\d+(?:\.\d+)?$/),
  }),
}).strict();

function contextFromPayload(payload: Prisma.JsonValue): { companyId: string; context: P0AIssuerContext } {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error(`P0-A job payload is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  return parsed.data;
}

/** Claims only the P0-A shadow type; no provider implementation is reachable. */
export async function runP0AShadowJobCycle(workerId: string, extractor: P0AExtractor = noProviderExtractor): Promise<boolean> {
  const claim = await claimNextJob(workerId, undefined, "FINANCIAL_EXTRACT_P0A_SHADOW");
  if (!claim) return false;
  await markJobRunning(claim);
  try {
    const job = await prisma.job.findUnique({ where: { id: claim.jobId }, include: { document: true } });
    if (!job?.document?.content) {
      await finishJob(claim, "NEEDS_INPUT", { errorCode: "DOCUMENT_CONTENT_UNAVAILABLE", errorMessage: "Verified local PDF bytes are unavailable." });
      return true;
    }
    const { companyId, context } = contextFromPayload(job.payload);
    const indexedPages = await loadCachedP0APageIndex(prisma, job.document.id, P0A_PARSER_VERSION);
    const result = await runP0AShadowPipeline({ bytes: Buffer.from(job.document.content), context, extractor, indexedPages: indexedPages ?? undefined });
    if (result.usage.providerCalls !== 0) throw new Error("P0-A shadow provider-call invariant violated.");
    await persistP0AShadowResult(prisma, { documentId: job.document.id, companyId, jobId: job.id, context, result });
    await finishJob(claim, "SUCCEEDED");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/payload|context|unavailable/i.test(message)) {
      await finishJob(claim, "NEEDS_INPUT", { errorCode: "P0A_INPUT_INVALID", errorMessage: message });
    } else {
      await scheduleJobRetry(claim, 30, { errorCode: "P0A_SHADOW_FAILED", errorMessage: message });
    }
  }
  return true;
}
