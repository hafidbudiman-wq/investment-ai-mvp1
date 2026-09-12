import { createHash } from "node:crypto";
import type { P0AApplicabilityDecision } from "@/lib/financial/p0a/applicability";
import { primaryPages, selectTargetedPages } from "@/lib/financial/p0a/page-router";
import type { P0AObservation, P0APlanTask, P0ARoutedPage } from "@/lib/financial/p0a/types";
import { P0A_VERSION_SET } from "@/lib/financial/p0a/versions";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function key(stage: P0APlanTask["stage"], pages: number[], requirements: string[], documentSha256: string): string {
  return hash({ documentSha256, stage, pages, requirements, versions: P0A_VERSION_SET });
}

export function planPrimaryTask(
  documentSha256: string,
  routedPages: readonly P0ARoutedPage[],
  applicability: readonly P0AApplicabilityDecision[],
  reusable: ReadonlyMap<string, P0AObservation> = new Map(),
): P0APlanTask {
  const requirementIds = applicability
    .filter((decision) => decision.expectation !== "NOT_APPLICABLE")
    .filter((decision) => decision.requirement.routes[0] === "PRIMARY")
    .filter((decision) => !reusable.has(decision.requirement.id))
    .map((decision) => decision.requirement.id)
    .sort();
  const selectedPages = primaryPages(routedPages);
  return { stage: "PRIMARY", requirementIds, selectedPages, route: "PRIMARY", cacheKey: key("PRIMARY", selectedPages, requirementIds, documentSha256) };
}

export function planTargetedTasks(
  documentSha256: string,
  routedPages: readonly P0ARoutedPage[],
  applicability: readonly P0AApplicabilityDecision[],
  resolvedRequirementIds: ReadonlySet<string>,
): P0APlanTask[] {
  const unresolved = applicability
    .filter((decision) => decision.expectation !== "NOT_APPLICABLE")
    .filter((decision) => !resolvedRequirementIds.has(decision.requirement.id))
    .filter((decision) => decision.requirement.routes.includes("NOTE"));
  const pageMap = selectTargetedPages(routedPages, unresolved.map((decision) => decision.requirement));
  const grouped = new Map<number, string[]>();
  for (const decision of unresolved) {
    for (const page of pageMap.get(decision.requirement.id) ?? []) {
      grouped.set(page, [...(grouped.get(page) ?? []), decision.requirement.id]);
    }
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([page, ids]) => {
    const requirementIds = [...new Set(ids)].sort();
    const selectedPages = [page];
    return { stage: "TARGETED", requirementIds, selectedPages, route: "NOTE", cacheKey: key("TARGETED", selectedPages, requirementIds, documentSha256) };
  });
}
