import type { P0ARequirement } from "@/lib/financial/p0a/types";

const p = (
  legacyCode: string,
  definition: string,
  statementType: P0ARequirement["statementType"],
  expectation: P0ARequirement["expectation"],
  unitType: P0ARequirement["unitType"],
  periodNature: P0ARequirement["periodNature"],
  routes: P0ARequirement["routes"],
  targetedAnchors: readonly string[] = [],
): P0ARequirement => ({
  id: `${legacyCode}_REPORTED`, legacyCode, definition, statementType,
  expectation, unitType, periodNature, routes, targetedAnchors,
});

/** Frozen P0-A subset of Canonical Data Contract v1.0 FINAL. */
export const P0A_REQUIREMENTS = [
  p("REV", "Issuer-reported revenue for the stated duration and scope.", "INCOME_STATEMENT", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("COGS", "Issuer-reported cost of sales; raw and normalized sign retained.", "INCOME_STATEMENT", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("GROSS_PROFIT", "Issuer-reported gross profit; calculation is a separate result.", "INCOME_STATEMENT", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("OPERATING_PROFIT", "Issuer-defined operating profit; never automatically relabeled EBIT.", "INCOME_STATEMENT", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY", "NOTE"]),
  p("FINANCE_INCOME", "Issuer-reported finance income.", "INCOME_STATEMENT", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY", "NOTE"]),
  p("FINANCE_COST", "Issuer-reported finance cost; not synonymous with interest expense.", "INCOME_STATEMENT", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY", "NOTE"]),
  p("PRETAX_PROFIT", "Profit before income tax for the stated duration and scope.", "INCOME_STATEMENT", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("TAX_EXPENSE", "Reported income-tax expense with its stated scope.", "INCOME_STATEMENT", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY", "NOTE"]),
  p("NET_PROFIT", "Total group profit including parent and NCI attribution.", "INCOME_STATEMENT", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("NET_PROFIT_PARENT", "Profit attributable to owners of the parent.", "INCOME_STATEMENT", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("EPS_BASIC", "Reported basic EPS with per-share scale one.", "INCOME_STATEMENT", "EXPECTED", "PER_SHARE", "DURATION", ["PRIMARY", "NOTE"], ["basic earnings per share", "laba per saham dasar"]),
  p("EPS_DILUTED", "Reported diluted EPS or evidenced not-applicable status.", "INCOME_STATEMENT", "OPTIONAL", "PER_SHARE", "DURATION", ["PRIMARY", "NOTE"], ["diluted earnings per share", "laba per saham dilusian"]),
  p("WEIGHTED_AVG_SHARES", "Duration denominator used for EPS; not period-end shares.", "INCOME_STATEMENT", "EXPECTED", "SHARES", "DURATION", ["NOTE", "PRIMARY"], ["weighted average number of shares", "jumlah rata-rata tertimbang saham"]),
  p("CASH", "Cash and cash equivalents at the reporting instant.", "BALANCE_SHEET", "EXPECTED", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY", "NOTE"]),
  p("AR", "Issuer-reported net trade receivables; component sum is calculated.", "BALANCE_SHEET", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY", "NOTE"]),
  p("INV", "Reported inventory net of allowance.", "BALANCE_SHEET", "EXPECTED", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY", "NOTE"]),
  p("CURRENT_ASSETS", "Issuer-reported current-assets control total.", "BALANCE_SHEET", "EXPECTED", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY"]),
  p("PPE", "Period-end net PPE; never interpreted as cash capex.", "BALANCE_SHEET", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY", "NOTE"]),
  p("TOTAL_ASSETS", "Balance-sheet total assets control.", "BALANCE_SHEET", "EXPECTED", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY"]),
  p("AP", "Issuer-reported trade payables; component sum is calculated.", "BALANCE_SHEET", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY", "NOTE"]),
  p("SHORT_TERM_DEBT", "Reported short-term debt excluding lease liabilities.", "BALANCE_SHEET", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY", "NOTE"]),
  p("CURRENT_LIAB", "Issuer-reported current-liabilities control total.", "BALANCE_SHEET", "EXPECTED", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY"]),
  p("LONG_TERM_DEBT", "Reported long-term debt excluding lease liabilities.", "BALANCE_SHEET", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY", "NOTE"]),
  p("TOTAL_LIAB", "Balance-sheet total liabilities control.", "BALANCE_SHEET", "EXPECTED", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY"]),
  p("EQUITY", "Total equity including NCI.", "BALANCE_SHEET", "EXPECTED", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY"]),
  p("EQUITY_PARENT", "Equity attributable to owners of the parent.", "BALANCE_SHEET", "EXPECTED", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY"]),
  p("NCI", "NCI within equity, distinct from NCI earnings.", "BALANCE_SHEET", "OPTIONAL", "DOCUMENT_CURRENCY", "INSTANT", ["PRIMARY"]),
  p("SHARES_ISSUED", "Issued and fully paid share count at period end.", "BALANCE_SHEET", "EXPECTED", "SHARES", "INSTANT", ["PRIMARY", "NOTE"], ["capital stock", "modal saham", "issued and fully paid"]),
  p("TREASURY_SHARES", "Treasury-share count; zero requires evidence.", "BALANCE_SHEET", "OPTIONAL", "SHARES", "INSTANT", ["NOTE", "PRIMARY", "OFFICIAL_EXTERNAL"], ["capital stock", "modal saham", "treasury shares", "saham treasuri"]),
  p("OCF", "Reported net cash from operating activities.", "CASH_FLOW", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("ICF", "Reported signed net investing cash flow.", "CASH_FLOW", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("CFF", "Reported signed net financing cash flow.", "CASH_FLOW", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("NET_CHANGE_CASH", "Reported net change in cash; bridge calculation remains separate.", "CASH_FLOW", "EXPECTED", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
  p("FX_EFFECT_CASH", "Reported FX effect on cash, separate from P&L and OCI FX.", "CASH_FLOW", "OPTIONAL", "DOCUMENT_CURRENCY", "DURATION", ["PRIMARY"]),
] as const satisfies readonly P0ARequirement[];

export const P0A_REQUIREMENT_BY_ID = new Map(P0A_REQUIREMENTS.map((item) => [item.id, item]));
export const P0A_REQUIREMENT_BY_CODE = new Map(P0A_REQUIREMENTS.map((item) => [item.legacyCode, item]));

export const P0A_EXCLUDED_LATER_PHASE_CODES = Object.freeze([
  "SHARES_OUTSTANDING", "TOTAL_DEBT", "CAPEX", "FCF", "SGA", "EBITDA",
  "DIVIDENDS_PAID", "SEGMENT_REVENUE", "SEGMENT_OPERATING_PROFIT",
]);
