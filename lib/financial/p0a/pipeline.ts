import { createHash } from "node:crypto";
import { resolveP0AApplicability } from "@/lib/financial/p0a/applicability";
import { assertEvidenceComplete } from "@/lib/financial/p0a/evidence";
import { planPrimaryTask, planTargetedTasks } from "@/lib/financial/p0a/fact-planner";
import { detectP0AGaps, resolvedReportedIds } from "@/lib/financial/p0a/gap-detector";
import { zeroAiShadowUsage } from "@/lib/financial/p0a/metering";
import type { P0AExtractor } from "@/lib/financial/p0a/mock-extractor";
import { createLocalPageIndex } from "@/lib/financial/p0a/page-index";
import { routePages } from "@/lib/financial/p0a/page-router";
import { createCrossIssuerNativeExtractor } from "@/lib/financial/p0a/cross-issuer-native-extractor";
import type { P0AIndexedPage, P0AIssuerContext, P0AObservation, P0APlanTask, P0AProviderUsage, P0ARequirementOutcome, P0ARoutedPage } from "@/lib/financial/p0a/types";
import { validateP0AOutcomes, type P0AValidationCheck } from "@/lib/financial/p0a/validation";
import { P0A_VERSION_SET } from "@/lib/financial/p0a/versions";

export type P0APipelineResult = {
  documentSha256: string;
  contextHash: string;
  versions: typeof P0A_VERSION_SET;
  routedPages: P0ARoutedPage[];
  tasks: P0APlanTask[];
  selectedPages: number[];
  observations: P0AObservation[];
  outcomes: P0ARequirementOutcome[];
  validations: P0AValidationCheck[];
  usage: P0AProviderUsage;
  shadowMode: true;
  realProviderExtractionPassed: false;
  pageIndexCacheHit: boolean;
};

function attempted(tasks: readonly P0APlanTask[]) {
  const routes = new Map<string, P0APlanTask["route"][]>();
  const pages = new Map<string, number[]>();
  for (const task of tasks) for (const id of task.requirementIds) {
    routes.set(id, [...(routes.get(id) ?? []), task.route]);
    pages.set(id, [...(pages.get(id) ?? []), ...task.selectedPages]);
  }
  return { routes, pages };
}

export async function runP0AShadowPipeline(input: { bytes: Buffer; context: P0AIssuerContext; extractor: P0AExtractor; indexedPages?: P0AIndexedPage[] }): Promise<P0APipelineResult> {
  const started = Date.now();
  const documentSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const contextHash = createHash("sha256").update(JSON.stringify({ documentSha256, context: input.context })).digest("hex");
  const index = input.indexedPages ?? await createLocalPageIndex(input.bytes);
  const routedPages = routePages(index);
  const applicability = resolveP0AApplicability(input.context);
  const planningIdentity = `${documentSha256}:${contextHash}`;
  const primary = planPrimaryTask(planningIdentity, routedPages, applicability);
  const observations = await input.extractor(primary, index);
  observations.flatMap((item) => item.evidence).forEach(assertEvidenceComplete);
  const firstAttempt = attempted([primary]);
  const interim = detectP0AGaps(applicability, observations, firstAttempt.routes, firstAttempt.pages, false);
  const targeted = planTargetedTasks(planningIdentity, routedPages, applicability, resolvedReportedIds(interim));
  for (const task of targeted) observations.push(...await input.extractor(task, index));
  observations.flatMap((item) => item.evidence).forEach(assertEvidenceComplete);
  const tasks = [primary, ...targeted];
  const allAttempts = attempted(tasks);
  const outcomes = detectP0AGaps(applicability, observations, allAttempts.routes, allAttempts.pages, true);
  const selectedPages = [...new Set(tasks.flatMap((task) => task.selectedPages))].sort((a, b) => a - b);
  return {
    documentSha256,
    contextHash,
    versions: P0A_VERSION_SET,
    routedPages,
    tasks,
    selectedPages,
    observations,
    outcomes,
    validations: validateP0AOutcomes(outcomes),
    usage: zeroAiShadowUsage(selectedPages.length, applicability.length, Date.now() - started),
    shadowMode: true,
    realProviderExtractionPassed: false,
    pageIndexCacheHit: input.indexedPages !== undefined,
  };
}

/** Phase 3/5 native-first entry point. No provider transport is reachable here. */
export async function runP0ANativePipeline(input: { bytes: Buffer; context: P0AIssuerContext; indexedPages?: P0AIndexedPage[] }): Promise<P0APipelineResult> {
  const started = Date.now();
  const pageIndexCacheHit = input.indexedPages !== undefined;
  const index = input.indexedPages ?? await createLocalPageIndex(input.bytes);
  const routedPages = routePages(index);
  const result = await runP0AShadowPipeline({
    ...input,
    indexedPages: index,
    extractor: createCrossIssuerNativeExtractor({ routedPages, context: input.context }),
  });
  return {
    ...result,
    usage: { ...result.usage, processingLatencyMs: Date.now() - started },
    pageIndexCacheHit,
  };
}
