import { CRITICAL_ACCOUNT_BY_CODE } from "@/lib/financial/critical-accounts.config";
import type { ValidatedFinancialExtraction } from "@/lib/financial/extraction-schema";

export type FinancialCandidate = ValidatedFinancialExtraction["candidates"][number];
export type CandidateRole = "FINAL_FACT" | "COMPONENT" | "DERIVED" | "DUPLICATE";
export type CandidateQualityStatus = "GREEN" | "YELLOW" | "RED";
export type AutomaticDecision = "ACCEPTED" | "REJECTED" | "PENDING";

export type LearnedCanonicalMapping = {
  normalizedLabel: string;
  statementType: string | null;
  canonicalCode: string;
  confidence: number;
  method: "MANUAL" | "RULE" | "AI";
};

export type CanonicalCandidateDecision = {
  candidate: FinancialCandidate;
  canonicalCode: string | null;
  componentOf: string | null;
  candidateRole: CandidateRole;
  qualityStatus: CandidateQualityStatus;
  qualityReasons: string[];
  automaticDecision: AutomaticDecision;
  mappingMethod: "MANUAL" | "RULE" | "AI" | null;
  mappingConfidence: number;
};

const DEBT_COMPONENT = /(?:pinjaman\s+bank|utang\s+(?:bank|pembiayaan)|bank\s+loans?|pinjaman[^\n]{0,50}non[-\s]?bank|non[-\s]?bank[^\n]{0,50}loans?|utang\s+jangka\s+panjang\s+lainnya|other\s+long[-\s]?term\s+debt|obligasi|bonds?|liabilitas\s+sewa|lease\s+liabilit(?:y|ies)|borrowings?)/i;
const DEBT_AGGREGATE = /(?:total|jumlah)[^\n]{0,60}(?:debt|utang\s+berbunga)|(?:total\s+interest[-\s]?bearing\s+debt)/i;
const CAPEX_COMPONENT = /(?:perolehan|pembelian|penambahan|acquisition|purchase|addition)[^\n]{0,90}(?:aset\s+tetap|property|plant|equipment|aset\s+minyak\s+dan\s+gas|oil\s+and\s+gas\s+propert|aset\s+eksplorasi\s+dan\s+evaluasi|exploration\s+and\s+evaluation|aset\s+konsesi|concession|aset\s+tak\s+berwujud|aset\s+tidak\s+berwujud|intangible)/i;
const CAPEX_AGGREGATE = /(?:capital\s+expenditure|belanja\s+modal|\bcapex\b)[^\n]{0,40}(?:aggregate|agregat|productive|total)?|(?:aggregate|agregat|total)[^\n]{0,40}(?:capital\s+expenditure|belanja\s+modal|\bcapex\b)/i;
const COUNTERPARTY_COMPONENT = /(?:pihak\s+ketiga|third\s+part|pihak\s+berelasi|pihak\s+berhubungan|related\s+part)/i;
const RULE_DERIVED = /^rule-derived/i;
const AI_DERIVED = /(?:aggregate|agregat|derived|diturunkan)/i;

export function normalizeCanonicalLabel(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

function numeric(candidate: FinancialCandidate) {
  return candidate.numericValue === null ? null : Number(candidate.numericValue);
}

function sameUnit(candidates: FinancialCandidate[]) {
  if (!candidates.length) return false;
  const first = candidates[0];
  return candidates.every((candidate) => candidate.scale === first.scale && (candidate.currency ?? "") === (first.currency ?? ""));
}

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(Math.abs(left) * 0.000000000001, Math.abs(right) * 0.000000000001, 1);
}

function evidenceIsComplete(candidate: FinancialCandidate) {
  return candidate.sourcePage !== null && Boolean(candidate.sourceText?.trim()) && candidate.extractionConfidence >= 0.98;
}

function inferredAggregateCode(candidate: FinancialCandidate) {
  const text = `${candidate.reportedLabel} ${candidate.sourceText ?? ""}`;
  if (DEBT_AGGREGATE.test(text)) return "TOTAL_DEBT";
  if (CAPEX_AGGREGATE.test(text)) return "CAPEX";
  if (/free\s+cash\s+flow|arus\s+kas\s+bebas/i.test(text)) return "FCF";
  return null;
}

function directMapping(candidate: FinancialCandidate, mappings: LearnedCanonicalMapping[]) {
  const learned = mappings.find((mapping) =>
    mapping.normalizedLabel === normalizeCanonicalLabel(candidate.reportedLabel)
    && (!mapping.statementType || mapping.statementType === candidate.statementType),
  );
  if (learned && CRITICAL_ACCOUNT_BY_CODE.has(learned.canonicalCode)) {
    return { code: learned.canonicalCode, confidence: learned.confidence, method: learned.method } as const;
  }
  const suggested = candidate.canonicalCode?.toUpperCase() ?? null;
  if (suggested && CRITICAL_ACCOUNT_BY_CODE.has(suggested)) {
    return { code: suggested, confidence: candidate.mappingConfidence, method: "AI" as const };
  }
  const inferred = inferredAggregateCode(candidate);
  return inferred ? { code: inferred, confidence: 1, method: "RULE" as const } : null;
}

function scoreFinalCandidate(candidate: FinancialCandidate, code: string, method: string) {
  const text = `${candidate.reportedLabel} ${candidate.sourceText ?? ""}`;
  let score = candidate.extractionConfidence * 10 + candidate.mappingConfidence * 10;
  if (RULE_DERIVED.test(candidate.sourceText ?? "")) score += 100;
  if (method === "MANUAL" || method === "RULE") score += 35;
  if (candidate.canonicalCode?.toUpperCase() === code) score += 25;
  if (!AI_DERIVED.test(candidate.reportedLabel) && !AI_DERIVED.test(candidate.sourceText ?? "")) score += 25;
  if (/(?:jumlah|total|neto|net\b)/i.test(text)) score += 10;
  return score;
}

function addFailure(decisions: CanonicalCandidateDecision[], codes: string[], reason: string) {
  for (const decision of decisions) {
    if (!decision.canonicalCode || !codes.includes(decision.canonicalCode) || decision.automaticDecision !== "ACCEPTED") continue;
    decision.qualityStatus = "YELLOW";
    decision.automaticDecision = "PENDING";
    decision.qualityReasons.push(reason);
  }
}

function winner(decisions: CanonicalCandidateDecision[], code: string) {
  return decisions.find((decision) => decision.canonicalCode === code && decision.automaticDecision === "ACCEPTED");
}

/**
 * Converts AI suggestions into deterministic canonical decisions. The model is
 * allowed to read rows; arithmetic, duplicate suppression, sign conventions,
 * evidence requirements, and safe auto-review are enforced here.
 */
export function classifyCanonicalCandidates(
  candidates: FinancialCandidate[],
  learnedMappings: LearnedCanonicalMapping[] = [],
): CanonicalCandidateDecision[] {
  const mapped = candidates.map((candidate, index) => ({ candidate, index, mapping: directMapping(candidate, learnedMappings) }));
  const capexComponents = mapped.filter(({ candidate }) => candidate.statementType === "CASH_FLOW" && CAPEX_COMPONENT.test(candidate.reportedLabel));
  const hasRevenueTotal = mapped.some(({ mapping }) => mapping?.code === "REV");
  const hasArTotal = mapped.some(({ candidate, mapping }) => mapping?.code === "AR" && !COUNTERPARTY_COMPONENT.test(candidate.reportedLabel));
  const hasApTotal = mapped.some(({ candidate, mapping }) => mapping?.code === "AP" && !COUNTERPARTY_COMPONENT.test(candidate.reportedLabel));

  const components = new Map<number, string | null>();
  for (const item of mapped) {
    const { candidate, mapping, index } = item;
    const label = candidate.reportedLabel;
    if (candidate.statementType === "BALANCE_SHEET" && DEBT_COMPONENT.test(label) && !DEBT_AGGREGATE.test(label)) components.set(index, "TOTAL_DEBT");
    else if (candidate.statementType === "CASH_FLOW" && CAPEX_COMPONENT.test(label) && (capexComponents.length > 1 || mapping?.code !== "CAPEX")) components.set(index, "CAPEX");
    else if (hasArTotal && COUNTERPARTY_COMPONENT.test(label) && /piutang\s+usaha|trade\s+receivable/i.test(label)) components.set(index, "AR");
    else if (hasApTotal && COUNTERPARTY_COMPONENT.test(label) && /utang\s+usaha|trade\s+payable/i.test(label)) components.set(index, "AP");
    else if (candidate.statementType === "INCOME_STATEMENT" && hasRevenueTotal && !mapping?.code && /pendapatan|revenue|finance\s+income/i.test(label)) components.set(index, "REV");
    else if (candidate.statementType === "CASH_FLOW" && /penambahan\s+aset\s+lain-lain|additions?\s+to\s+other\s+assets/i.test(label)) components.set(index, "CAPEX");
  }

  const decisions: CanonicalCandidateDecision[] = mapped.map(({ candidate, index, mapping }) => {
    const componentOf = components.get(index) ?? null;
    if (components.has(index)) {
      return {
        candidate,
        canonicalCode: null,
        componentOf,
        candidateRole: "COMPONENT",
        qualityStatus: "GREEN",
        qualityReasons: [componentOf === "CAPEX" && /aset\s+lain-lain|other\s+assets/i.test(candidate.reportedLabel)
          ? "Excluded from canonical CAPEX because the label does not prove a productive long-lived asset. Preserved as evidence."
          : `Preserved as a source component of ${componentOf}; the reconciled canonical total is stored once.`],
        automaticDecision: "REJECTED",
        mappingMethod: "RULE",
        mappingConfidence: 1,
      };
    }
    if (!mapping) {
      return {
        candidate,
        canonicalCode: null,
        componentOf: null,
        candidateRole: "COMPONENT",
        qualityStatus: "GREEN",
        qualityReasons: ["Evidence row is outside the 13 critical canonical facts and is not committed."],
        automaticDecision: "REJECTED",
        mappingMethod: null,
        mappingConfidence: 0,
      };
    }
    return {
      candidate,
      canonicalCode: mapping.code,
      componentOf: null,
      candidateRole: RULE_DERIVED.test(candidate.sourceText ?? "") || inferredAggregateCode(candidate) === mapping.code ? "DERIVED" : "FINAL_FACT",
      qualityStatus: "YELLOW",
      qualityReasons: [],
      automaticDecision: "PENDING",
      mappingMethod: mapping.method,
      mappingConfidence: mapping.confidence,
    };
  });

  for (const code of CRITICAL_ACCOUNT_BY_CODE.keys()) {
    const group = decisions.filter((decision) => decision.canonicalCode === code);
    if (!group.length) continue;
    const ruleWinner = group.find((decision) => RULE_DERIVED.test(decision.candidate.sourceText ?? ""));
    const values = group.map((decision) => numeric(decision.candidate)).filter((value): value is number => value !== null);
    const allEqual = values.length === group.length && values.every((value) => approximatelyEqual(value, values[0]));
    if (group.length > 1 && !allEqual && !ruleWinner) {
      for (const decision of group) decision.qualityReasons.push(`Conflicting ${code} values require exception review.`);
      continue;
    }
    const selected = ruleWinner ?? [...group].sort((left, right) =>
      scoreFinalCandidate(right.candidate, code, right.mappingMethod ?? "") - scoreFinalCandidate(left.candidate, code, left.mappingMethod ?? ""),
    )[0];
    for (const decision of group) {
      if (decision !== selected) {
        decision.canonicalCode = null;
        decision.candidateRole = "DUPLICATE";
        decision.qualityStatus = "GREEN";
        decision.qualityReasons = [`Superseded by the deterministic ${code} winner; retained only for audit evidence.`];
        decision.automaticDecision = "REJECTED";
        decision.mappingMethod = "RULE";
        decision.mappingConfidence = 1;
        continue;
      }
      const account = CRITICAL_ACCOUNT_BY_CODE.get(code)!;
      const statementMatches = selected.candidate.statementType === account.statementType;
      if (!statementMatches) {
        selected.qualityStatus = "RED";
        selected.qualityReasons.push(`Statement type conflicts with canonical ${code}.`);
      } else if (!evidenceIsComplete(selected.candidate)) {
        selected.qualityStatus = "YELLOW";
        selected.qualityReasons.push("Source page/text or extraction confidence is below the automatic threshold.");
      } else if (selected.mappingConfidence < 0.95 && selected.mappingMethod === "AI") {
        selected.qualityStatus = "YELLOW";
        selected.qualityReasons.push("AI mapping confidence is below 95% and no approved issuer mapping exists.");
      } else {
        selected.qualityStatus = "GREEN";
        selected.qualityReasons.push(`Source evidence and canonical ${code} mapping passed deterministic checks.`);
        selected.automaticDecision = "ACCEPTED";
        selected.mappingMethod = selected.mappingMethod === "MANUAL" ? "MANUAL" : "RULE";
        selected.mappingConfidence = 1;
      }
    }
  }

  const revenue = winner(decisions, "REV");
  const cogs = winner(decisions, "COGS");
  const gross = winner(decisions, "GROSS_PROFIT");
  if (revenue && cogs && gross && sameUnit([revenue.candidate, cogs.candidate, gross.candidate])) {
    const expected = numeric(revenue.candidate)! - Math.abs(numeric(cogs.candidate)!);
    if (!approximatelyEqual(expected, numeric(gross.candidate)!)) addFailure(decisions, ["REV", "COGS", "GROSS_PROFIT"], "Revenue - COGS does not reconcile to gross profit.");
    else for (const decision of [revenue, cogs, gross]) decision.qualityReasons.push("Gross-profit equation reconciles.");
  }

  const ocf = winner(decisions, "OCF");
  const capex = winner(decisions, "CAPEX");
  const fcf = winner(decisions, "FCF");
  if (ocf && capex && fcf && sameUnit([ocf.candidate, capex.candidate, fcf.candidate])) {
    const expected = numeric(ocf.candidate)! + numeric(capex.candidate)!;
    if (!approximatelyEqual(expected, numeric(fcf.candidate)!)) addFailure(decisions, ["OCF", "CAPEX", "FCF"], "OCF + negative CAPEX does not reconcile to FCF.");
    else for (const decision of [ocf, capex, fcf]) decision.qualityReasons.push("FCF equation reconciles.");
  }

  const debt = winner(decisions, "TOTAL_DEBT");
  const debtParts = decisions.filter((decision) => decision.componentOf === "TOTAL_DEBT").map((decision) => decision.candidate);
  if (debt && debtParts.length && sameUnit([debt.candidate, ...debtParts])) {
    const expected = debtParts.reduce((sum, candidate) => sum + Math.abs(numeric(candidate) ?? 0), 0);
    if (!approximatelyEqual(expected, Math.abs(numeric(debt.candidate)!))) addFailure(decisions, ["TOTAL_DEBT"], "Debt components do not reconcile to total debt.");
    else debt.qualityReasons.push("Current/non-current debt and lease components reconcile to total debt.");
  }

  const capexParts = decisions.filter((decision) => decision.componentOf === "CAPEX" && CAPEX_COMPONENT.test(decision.candidate.reportedLabel)).map((decision) => decision.candidate);
  if (capex && capexParts.length && sameUnit([capex.candidate, ...capexParts])) {
    const expected = -capexParts.reduce((sum, candidate) => sum + Math.abs(numeric(candidate) ?? 0), 0);
    if (!approximatelyEqual(expected, numeric(capex.candidate)!)) addFailure(decisions, ["CAPEX", "FCF"], "Qualifying productive-asset additions do not reconcile to CAPEX.");
    else capex.qualityReasons.push("Qualifying productive-asset additions reconcile to CAPEX.");
  }

  for (const code of ["AR", "AP"] as const) {
    const total = winner(decisions, code);
    const parts = decisions.filter((decision) => decision.componentOf === code).map((decision) => decision.candidate);
    if (!total || parts.length < 2 || !sameUnit([total.candidate, ...parts])) continue;
    const expected = parts.reduce((sum, candidate) => sum + Math.abs(numeric(candidate) ?? 0), 0);
    if (!approximatelyEqual(expected, Math.abs(numeric(total.candidate)!))) addFailure(decisions, [code], `${code} counterparty components do not reconcile to the total.`);
    else total.qualityReasons.push(`${code} counterparty components reconcile to the total.`);
  }

  for (const decision of decisions) {
    if (decision.automaticDecision === "PENDING" && decision.qualityStatus === "GREEN") decision.qualityStatus = "YELLOW";
    if (decision.qualityStatus !== "GREEN") decision.automaticDecision = "PENDING";
  }
  return decisions;
}

export function summarizeCanonicalDecisions(decisions: CanonicalCandidateDecision[]) {
  const verifiedCodes = decisions.filter((decision) => decision.automaticDecision === "ACCEPTED" && decision.canonicalCode).map((decision) => decision.canonicalCode!);
  const missingCodes = [...CRITICAL_ACCOUNT_BY_CODE.keys()].filter((code) => !verifiedCodes.includes(code));
  return {
    verifiedFacts: verifiedCodes.length,
    evidenceOnly: decisions.filter((decision) => decision.automaticDecision === "REJECTED").length,
    exceptions: decisions.filter((decision) => decision.automaticDecision === "PENDING").length,
    verifiedCodes,
    missingCodes,
  };
}
