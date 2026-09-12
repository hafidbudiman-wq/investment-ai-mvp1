import type { P0AApplicabilityDecision } from "@/lib/financial/p0a/applicability";
import type { P0AObservation, P0ARequirementOutcome, P0ASourceRoute } from "@/lib/financial/p0a/types";

export function detectP0AGaps(
  applicability: readonly P0AApplicabilityDecision[],
  observations: readonly P0AObservation[],
  attemptedRoutes: ReadonlyMap<string, readonly P0ASourceRoute[]>,
  attemptedPages: ReadonlyMap<string, readonly number[]>,
  finalPass: boolean,
): P0ARequirementOutcome[] {
  const grouped = new Map<string, P0AObservation[]>();
  for (const observation of observations) grouped.set(observation.requirementId, [...(grouped.get(observation.requirementId) ?? []), observation]);

  return applicability.map((decision) => {
    const found = grouped.get(decision.requirement.id) ?? [];
    const reported = found.find((item) => item.origin === "REPORTED") ?? null;
    const calculated = found.find((item) => item.origin === "STANDARDIZED_AGGREGATE") ?? null;
    const routes = [...(attemptedRoutes.get(decision.requirement.id) ?? [])];
    const pages = [...new Set(attemptedPages.get(decision.requirement.id) ?? [])].sort((a, b) => a - b);

    if (decision.expectation === "NOT_APPLICABLE" || reported?.state === "NOT_APPLICABLE") {
      return { requirementId: decision.requirement.id, applicability: "NOT_APPLICABLE", state: "NOT_APPLICABLE", reportedObservation: reported, calculatedAlternative: calculated, attemptedRoutes: routes, attemptedPages: pages, reason: decision.rationale };
    }
    if (reported) {
      const state = reported.state === "ZERO" ? "ZERO" : "VALUE";
      return { requirementId: decision.requirement.id, applicability: decision.expectation, state, reportedObservation: reported, calculatedAlternative: calculated, attemptedRoutes: routes, attemptedPages: pages, reason: "Evidence-backed reported observation validated." };
    }
    const state = finalPass && decision.expectation === "OPTIONAL" ? "NOT_DISCLOSED" : "MISSING";
    const reason = calculated
      ? "No reported scalar found; a separately labeled standardized aggregate is available."
      : finalPass ? "Allowed P0-A routes exhausted without reliable evidence." : "Applicable fact remains unresolved after the current stage.";
    return { requirementId: decision.requirement.id, applicability: decision.expectation, state, reportedObservation: null, calculatedAlternative: calculated, attemptedRoutes: routes, attemptedPages: pages, reason };
  });
}

export function resolvedReportedIds(outcomes: readonly P0ARequirementOutcome[]): Set<string> {
  return new Set(outcomes.filter((outcome) => ["VALUE", "ZERO", "NOT_APPLICABLE"].includes(outcome.state)).map((outcome) => outcome.requirementId));
}
