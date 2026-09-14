import type { Phase6ARequirement } from "@/lib/financial/p0b/types";

export const PHASE6A_MANIFEST_VERSION = "investai-canonical-v1.0-final:p0-b-phase6a";
export const PHASE6A_EXTRACTOR_VERSION = "p0b-phase6a-deterministic-v1";
export const PHASE6A_FORMULA_REGISTRY_VERSION = "p0b-phase6a-formulas-v1";

const reported = (canonicalCode: string, definition: string, applicability: "EXPECTED" | "OPTIONAL", unitType: Phase6ARequirement["unitType"], periodNature: Phase6ARequirement["periodNature"]): Phase6ARequirement => ({ requirementId: canonicalCode, canonicalCode, family: "REPORTED", definition, applicability, unitType, periodNature });
const calculated = (canonicalCode: string, definition: string, unitType: Phase6ARequirement["unitType"], periodNature: Phase6ARequirement["periodNature"]): Phase6ARequirement => ({ requirementId: canonicalCode, canonicalCode, family: "CALCULATED", definition, applicability: "OPTIONAL", unitType, periodNature });

export const PHASE6A_REQUIREMENTS: readonly Phase6ARequirement[] = Object.freeze([
  reported("SHARES_OUTSTANDING_REPORTED", "Issuer-reported period-end outstanding shares; never issued, treasury, or weighted-average shares.", "EXPECTED", "SHARES", "INSTANT"),
  reported("TOTAL_DEBT_REPORTED", "Issuer-reported total debt scalar with explicit inclusion scope.", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT"),
  calculated("TOTAL_DEBT_CALCULATED", "InvestAI sum of accepted short-term debt ex lease, long-term debt ex lease, and total lease liabilities.", "DOCUMENT_CURRENCY", "INSTANT"),
  reported("LEASE_LIABILITIES_REPORTED", "Issuer-reported total lease-liabilities scalar.", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT"),
  calculated("LEASE_LIABILITIES_CALCULATED", "Current plus noncurrent accepted lease-liability facts.", "DOCUMENT_CURRENCY", "INSTANT"),
  reported("SGA_REPORTED", "Issuer-reported combined selling, general and administrative expense subtotal.", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION"),
  calculated("SGA_CALCULATED", "Accepted selling/distribution plus general/administrative expense components.", "DOCUMENT_CURRENCY", "DURATION"),
  reported("EBITDA_REPORTED", "Explicit issuer-reported EBITDA for the stated duration and scope.", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION"),
  calculated("EBITDA_CALCULATED", "InvestAI-calculated EBITDA under a frozen formula definition.", "DOCUMENT_CURRENCY", "DURATION"),
  reported("INTEREST_EXPENSE_REPORTED", "Issuer-reported interest expense, distinct from total finance cost.", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION"),
  reported("RESTRICTED_CASH_REPORTED", "Explicit restricted-cash scalar with restriction and current/noncurrent scope retained.", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT"),
  reported("OCI_TOTAL_REPORTED", "Issuer-reported total other comprehensive income or loss for the period.", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION"),
  reported("TOTAL_COMPREHENSIVE_INCOME_REPORTED", "Issuer-reported total comprehensive income for the period.", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION"),
  reported("CAPEX_PPE_CASH_REPORTED", "Cash outflow for purchase/addition of PPE and qualifying fixed-asset advances only.", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION"),
  reported("CAPEX_INTANGIBLE_CASH_REPORTED", "Cash outflow for purchase/addition of intangible assets only.", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION"),
  reported("CAPEX_TOTAL_CASH_REPORTED", "Issuer-reported total cash capex scalar with inclusion scope.", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION"),
  calculated("CAPEX_TOTAL_CASH_CALCULATED", "Sum of accepted eligible cash capex components; undisclosed types are never imputed.", "DOCUMENT_CURRENCY", "DURATION"),
  calculated("FCF_CALCULATED", "Operating cash flow plus signed eligible total cash capex.", "DOCUMENT_CURRENCY", "DURATION"),
]);

export type Phase6AFormula = {
  formulaId: string;
  code: string;
  formulaVersion: string;
  expression: string;
  inputRoles: readonly string[];
  inclusionRules: readonly string[];
  exclusionRules: readonly string[];
};

export const PHASE6A_FORMULAS: readonly Phase6AFormula[] = Object.freeze([
  { formulaId: "P0B-LEASE-TOTAL", code: "LEASE_LIABILITIES_CALCULATED", formulaVersion: "1.0.0", expression: "LEASE_CURRENT + LEASE_NONCURRENT", inputRoles: ["LEASE_CURRENT", "LEASE_NONCURRENT"], inclusionRules: ["Same instant, entity, scope, currency and scale."], exclusionRules: ["Do not include unrelated lease commitments or right-of-use assets."] },
  { formulaId: "P0B-TOTAL-DEBT-INCL-LEASES", code: "TOTAL_DEBT_CALCULATED", formulaVersion: "1.0.0", expression: "SUM(ACCEPTED_SHORT_TERM_DEBT_EX_LEASE_COMPONENTS) + SUM(ACCEPTED_LONG_TERM_DEBT_EX_LEASE_COMPONENTS) + LEASE_LIABILITIES_TOTAL", inputRoles: ["ACCEPTED_SHORT_TERM_DEBT_EX_LEASE_COMPONENTS", "ACCEPTED_LONG_TERM_DEBT_EX_LEASE_COMPONENTS", "LEASE_LIABILITIES_TOTAL"], inclusionRules: ["At least one accepted short-term/current-maturity component, at least one accepted long-term component, and total leases; borrowings, bonds/notes and other interest-bearing debt are included when explicitly presented; leases are added exactly once."], exclusionRules: ["Trade payables, ordinary operating liabilities and duplicated instrument subtotals."] },
  { formulaId: "P0B-SGA", code: "SGA_CALCULATED", formulaVersion: "1.0.0", expression: "SELLING_DISTRIBUTION_EXPENSE + GENERAL_ADMINISTRATIVE_EXPENSE", inputRoles: ["SELLING_DISTRIBUTION_EXPENSE", "GENERAL_ADMINISTRATIVE_EXPENSE"], inclusionRules: ["Presentation supports equivalent period and scope; preserve reported signs."], exclusionRules: ["Other operating expenses and arbitrary operating-cost lines."] },
  { formulaId: "P0B-CAPEX-TOTAL-CASH", code: "CAPEX_TOTAL_CASH_CALCULATED", formulaVersion: "1.0.0", expression: "SUM(ELIGIBLE_DISCLOSED_CASH_CAPEX_COMPONENTS)", inputRoles: ["CAPEX_PPE_CASH", "CAPEX_PPE_ADVANCE_CASH", "CAPEX_INTANGIBLE_CASH", "CAPEX_EXPLORATION_EVALUATION_CASH", "CAPEX_CONCESSION_CASH", "CAPEX_OIL_GAS_PROPERTY_CASH"], inclusionRules: ["Cash-flow-based productive long-lived asset outflows and explicitly labeled fixed-asset purchase advances only; use only components actually disclosed and accepted."], exclusionRules: ["Segment capex, generic other assets without proven productive scope, accounting additions, roll-forward additions, acquisition consideration and non-cash additions."] },
  { formulaId: "P0B-FCF", code: "FCF_CALCULATED", formulaVersion: "1.0.0", expression: "OCF_REPORTED + SIGNED_CAPEX_TOTAL_CASH", inputRoles: ["OCF_REPORTED", "SIGNED_CAPEX_TOTAL_CASH"], inclusionRules: ["Same entity, duration, scope, currency and scale."], exclusionRules: ["No annualization, imputation or note-based accounting additions."] },
]);

export const PHASE6A_FORMULA_BY_CODE = new Map(PHASE6A_FORMULAS.map((item) => [item.code, item]));
