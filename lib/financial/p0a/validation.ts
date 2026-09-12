import type { P0ARequirementOutcome } from "@/lib/financial/p0a/types";

export type P0AValidationCheck = { id: string; passed: boolean; detail: string };

function integer(outcomes: readonly P0ARequirementOutcome[], code: string): bigint | null {
  const found = outcomes.find((outcome) => outcome.requirementId === `${code}_REPORTED`)?.reportedObservation?.decimalValue;
  return found === null || found === undefined ? null : BigInt(found);
}

function equality(id: string, left: bigint | null, right: bigint | null): P0AValidationCheck {
  if (left === null || right === null) return { id, passed: false, detail: "Required reported inputs are unavailable." };
  return { id, passed: left === right, detail: `${left.toString()} ${left === right ? "=" : "!="} ${right.toString()}` };
}

/** P0-A checks are transient; no derived metric rows are persisted. */
export function validateP0AOutcomes(outcomes: readonly P0ARequirementOutcome[]): P0AValidationCheck[] {
  const assets = integer(outcomes, "TOTAL_ASSETS");
  const liabilities = integer(outcomes, "TOTAL_LIAB");
  const equity = integer(outcomes, "EQUITY");
  const netChange = integer(outcomes, "NET_CHANGE_CASH");
  const ocf = integer(outcomes, "OCF");
  const icf = integer(outcomes, "ICF");
  const cff = integer(outcomes, "CFF");
  const fx = integer(outcomes, "FX_EFFECT_CASH");
  return [
    equality("BALANCE_SHEET_IDENTITY", assets, liabilities !== null && equity !== null ? liabilities + equity : null),
    equality("CASH_FLOW_BRIDGE", netChange, ocf !== null && icf !== null && cff !== null && fx !== null ? ocf + icf + cff + fx : null),
  ];
}
