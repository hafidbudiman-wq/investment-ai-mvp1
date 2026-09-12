import { P0A_REQUIREMENTS } from "@/lib/financial/p0a/requirements";
import type { P0AExpectation, P0AIssuerContext, P0ARequirement } from "@/lib/financial/p0a/types";
import { P0A_APPLICABILITY_VERSION } from "@/lib/financial/p0a/versions";

export type P0AApplicabilityDecision = {
  requirement: P0ARequirement;
  expectation: P0AExpectation;
  ruleVersion: string;
  rationale: string;
};

/**
 * P0-A intentionally implements only the reviewed non-financial corporate
 * policy. Financial issuers fail closed until their accounting pack is built.
 */
export function resolveP0AApplicability(context: P0AIssuerContext): P0AApplicabilityDecision[] {
  if (context.accountingModel !== "NON_FINANCIAL") {
    return P0A_REQUIREMENTS.map((requirement) => ({
      requirement,
      expectation: "NOT_APPLICABLE",
      ruleVersion: P0A_APPLICABILITY_VERSION,
      rationale: `P0-A pilot has no approved ${context.accountingModel} accounting pack.`,
    }));
  }

  return P0A_REQUIREMENTS.map((requirement) => {
    let expectation = requirement.expectation;
    let rationale = `Frozen P0-A NON_FINANCIAL rule: ${expectation}.`;

    if (!context.consolidated && ["NET_PROFIT_PARENT", "EQUITY_PARENT", "NCI"].includes(requirement.legacyCode)) {
      expectation = "NOT_APPLICABLE";
      rationale = "Parent/NCI attribution is not applicable to a confirmed standalone report.";
    }
    if (context.issuerType !== "LISTED_COMMON_EQUITY" && ["EPS_BASIC", "EPS_DILUTED", "WEIGHTED_AVG_SHARES", "SHARES_ISSUED", "TREASURY_SHARES"].includes(requirement.legacyCode)) {
      expectation = "NOT_APPLICABLE";
      rationale = "Share and EPS controls require listed common equity.";
    }

    return { requirement, expectation, ruleVersion: P0A_APPLICABILITY_VERSION, rationale };
  });
}
