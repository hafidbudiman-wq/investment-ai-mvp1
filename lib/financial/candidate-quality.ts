import type { ValidatedFinancialExtraction } from "@/lib/financial/extraction-schema";

type Candidate = ValidatedFinancialExtraction["candidates"][number];

const DEBT_COMPONENT = /(?:pinjaman\s+bank|utang\s+(?:bank|pembiayaan)|bank\s+loans?|pinjaman[^\n]{0,50}non[-\s]?bank|non[-\s]?bank[^\n]{0,50}loans?|utang\s+jangka\s+panjang\s+lainnya|other\s+long[-\s]?term\s+debt|obligasi|bonds?|liabilitas\s+sewa|lease\s+liabilit(?:y|ies)|borrowings?)/i;
const LEASE_COMPONENT = /(?:liabilitas\s+sewa|lease\s+liabilit(?:y|ies))/i;
const AGGREGATE_LABEL = /(?:^|\b)(?:jumlah|total|utang\s+berbunga|interest[-\s]?bearing\s+debt)(?:\b|$)/i;
const CAPEX_COMPONENT = /(?:perolehan|pembelian|penambahan|acquisition|purchase|addition)[^\n]{0,90}(?:aset\s+tetap|property|plant|equipment|aset\s+minyak\s+dan\s+gas|oil\s+and\s+gas\s+propert|aset\s+eksplorasi\s+dan\s+evaluasi|exploration\s+and\s+evaluation|aset\s+konsesi|concession|aset\s+tak\s+berwujud|aset\s+tidak\s+berwujud|intangible)/i;
const COUNTERPARTY_COMPONENT = /(?:pihak\s+ketiga|third\s+part|pihak\s+berelasi|pihak\s+berhubungan|related\s+part)/i;
const COUNTERPARTY_TOTAL = /(?:jumlah|total|neto|net\b)/i;

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Restores traceable chunk metadata only when the model returned page-traced
 * candidates but omitted its chunk summaries. Empty candidate payloads still
 * fail schema validation instead of being disguised as successful extraction.
 */
export function ensureCandidateBackedChunks(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.chunks) || value.chunks.length > 0 || !Array.isArray(value.candidates) || value.candidates.length === 0) return value;
  const pages = value.candidates
    .filter(isRecord)
    .map((candidate) => candidate.sourcePage)
    .filter((page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0);
  const pageStart = pages.length ? Math.min(...pages) : null;
  const pageEnd = pages.length ? Math.max(...pages) : null;
  return {
    ...value,
    chunks: [{
      section: "Financial statement candidates - chunk summary reconstructed from source-page evidence",
      chunkType: "SECTION",
      pageStart,
      pageEnd,
      textSummary: `Fallback chunk covering ${value.candidates.length} page-traced extraction candidates.`,
    }],
  };
}

function uniqueComponents(candidates: Candidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${normalized(candidate.reportedLabel)}:${candidate.sourcePage ?? "?"}:${candidate.numericValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameUnit(candidates: Candidate[]) {
  if (!candidates.length) return false;
  const first = candidates[0];
  return candidates.every((candidate) =>
    candidate.scale === first.scale
    && (candidate.currency ?? "") === (first.currency ?? ""),
  );
}

function aggregateCandidate(
  code: "TOTAL_DEBT" | "CAPEX",
  label: string,
  components: Candidate[],
): Candidate {
  const value = components.reduce((sum, candidate) => sum + Number(candidate.numericValue), 0);
  const pages = [...new Set(components.map((candidate) => candidate.sourcePage).filter((page): page is number => page !== null))];
  const evidence = components
    .map((candidate) => `${candidate.reportedLabel} ${candidate.rawValue} (page ${candidate.sourcePage ?? "?"})`)
    .join("; ");
  return {
    statementType: code === "TOTAL_DEBT" ? "BALANCE_SHEET" : "CASH_FLOW",
    reportedLabel: label,
    rawValue: String(value),
    numericValue: value,
    currency: components[0].currency,
    scale: components[0].scale,
    sourcePage: pages.length ? pages[0] : components[0].sourcePage,
    sourceText: `Rule-derived from source components: ${evidence}`.slice(0, 2_000),
    canonicalCode: code,
    extractionConfidence: Math.min(...components.map((candidate) => candidate.extractionConfidence)),
    mappingConfidence: 1,
  };
}

function debtComponents(candidates: Candidate[]) {
  return uniqueComponents(candidates.filter((candidate) =>
    candidate.statementType === "BALANCE_SHEET"
    && candidate.numericValue !== null
    && Number(candidate.numericValue) >= 0
    && DEBT_COMPONENT.test(candidate.reportedLabel)
    && !AGGREGATE_LABEL.test(candidate.reportedLabel),
  ));
}

function capexComponents(candidates: Candidate[]) {
  return uniqueComponents(candidates.filter((candidate) =>
    candidate.statementType === "CASH_FLOW"
    && candidate.numericValue !== null
    && CAPEX_COMPONENT.test(candidate.reportedLabel),
  ).map((candidate) => ({ ...candidate, numericValue: -Math.abs(Number(candidate.numericValue)) })));
}

function preferVerifiedCounterpartyTotal(candidates: Candidate[], code: "AR" | "AP") {
  const mapped = candidates.filter((candidate) => candidate.canonicalCode === code && candidate.numericValue !== null);
  const components = mapped.filter((candidate) => COUNTERPARTY_COMPONENT.test(candidate.reportedLabel));
  const total = mapped.find((candidate) =>
    !COUNTERPARTY_COMPONENT.test(candidate.reportedLabel)
    && (COUNTERPARTY_TOTAL.test(candidate.reportedLabel) || /aggregat|sum(?:med)?\s+from/i.test(candidate.sourceText ?? "")),
  );
  if (!total || components.length < 2 || !sameUnit([total, ...components])) return candidates;
  const componentTotal = components.reduce((sum, candidate) => sum + Number(candidate.numericValue), 0);
  const tolerance = Math.max(Math.abs(Number(total.numericValue)) * 0.000001, 1);
  if (Math.abs(componentTotal - Number(total.numericValue)) > tolerance) return candidates;

  const componentKeys = new Set(components.map((candidate) => `${normalized(candidate.reportedLabel)}:${candidate.sourcePage ?? "?"}:${candidate.numericValue}`));
  return candidates.map((candidate) => componentKeys.has(`${normalized(candidate.reportedLabel)}:${candidate.sourcePage ?? "?"}:${candidate.numericValue}`)
    ? { ...candidate, canonicalCode: null, mappingConfidence: 0 }
    : candidate);
}

/**
 * Applies deterministic investor-account rules after schema validation.
 * AI remains responsible for reading source rows; arithmetic, sign conventions,
 * and known aggregation requirements are enforced here before human review.
 */
export function refineFinancialCandidates(extraction: ValidatedFinancialExtraction): ValidatedFinancialExtraction {
  let candidates = extraction.candidates.map((candidate) => {
    if (candidate.canonicalCode === "COGS" && candidate.numericValue !== null) {
      return { ...candidate, numericValue: Math.abs(Number(candidate.numericValue)) };
    }
    if (candidate.canonicalCode === "CAPEX" && candidate.numericValue !== null) {
      return { ...candidate, numericValue: -Math.abs(Number(candidate.numericValue)) };
    }
    return candidate;
  });

  candidates = preferVerifiedCounterpartyTotal(candidates, "AR");
  candidates = preferVerifiedCounterpartyTotal(candidates, "AP");

  const debt = debtComponents(candidates);
  const hasLease = debt.some((candidate) => LEASE_COMPONENT.test(candidate.reportedLabel));
  if (debt.length >= 2 && hasLease && sameUnit(debt)) {
    candidates = candidates.map((candidate) => candidate.canonicalCode === "TOTAL_DEBT"
      ? { ...candidate, canonicalCode: null, mappingConfidence: 0 }
      : candidate);
    candidates.push(aggregateCandidate("TOTAL_DEBT", "Total interest-bearing debt including lease liabilities", debt));
  } else {
    candidates = candidates.map((candidate) => candidate.canonicalCode === "TOTAL_DEBT" && /lease\s+liabilit(?:y|ies)\s+excluded|liabilitas\s+sewa\s+tidak\s+termasuk/i.test(candidate.sourceText ?? "")
      ? { ...candidate, canonicalCode: null, mappingConfidence: 0 }
      : candidate);
  }

  const capex = capexComponents(candidates);
  if (capex.length >= 2 && sameUnit(capex)) {
    candidates = candidates.map((candidate) => candidate.canonicalCode === "CAPEX"
      ? { ...candidate, canonicalCode: null, mappingConfidence: 0 }
      : candidate);
    candidates.push(aggregateCandidate("CAPEX", "Capital expenditure - productive long-lived asset additions", capex));
  }

  const ocf = candidates.find((candidate) => candidate.canonicalCode === "OCF" && candidate.numericValue !== null);
  const canonicalCapex = candidates.find((candidate) => candidate.canonicalCode === "CAPEX" && candidate.numericValue !== null);
  if (ocf && canonicalCapex && sameUnit([ocf, canonicalCapex])) {
    const value = Number(ocf.numericValue) + Number(canonicalCapex.numericValue);
    candidates = candidates.filter((candidate) => candidate.canonicalCode !== "FCF");
    candidates.push({
      statementType: "CASH_FLOW",
      reportedLabel: "Free cash flow (OCF + negative CAPEX)",
      rawValue: String(value),
      numericValue: value,
      currency: ocf.currency,
      scale: ocf.scale,
      sourcePage: ocf.sourcePage,
      sourceText: `Rule-derived: OCF ${ocf.rawValue} (page ${ocf.sourcePage ?? "?"}) + CAPEX ${canonicalCapex.rawValue} (${canonicalCapex.sourceText ?? "source evidence unavailable"}).`.slice(0, 2_000),
      canonicalCode: "FCF",
      extractionConfidence: Math.min(ocf.extractionConfidence, canonicalCapex.extractionConfidence),
      mappingConfidence: 1,
    });
  }

  return { ...extraction, candidates };
}
