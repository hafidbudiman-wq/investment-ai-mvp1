export type CompanyIdentity = { ticker: string; name: string };

function normalizedWords(value: string) {
  return value.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

function normalizedName(value: string) {
  return normalizedWords(value).join("");
}

export function companyFromFileName(fileName: string, companies: CompanyIdentity[]): CompanyIdentity | null {
  const words = new Set(normalizedWords(fileName));
  const matches = companies.filter((company) => words.has(company.ticker.toUpperCase()));
  return matches.length === 1 ? matches[0] : null;
}

export function applyCompanyFallback(
  value: unknown,
  fallback: CompanyIdentity | null,
): unknown {
  if (!fallback || !value || typeof value !== "object") return value;
  const result = { ...(value as Record<string, unknown>) };
  const ticker = typeof result.detectedCompanyTicker === "string" ? result.detectedCompanyTicker.trim() : "";
  const name = typeof result.detectedCompanyName === "string" ? result.detectedCompanyName.trim() : "";
  const tickerAgrees = !ticker || ticker.toUpperCase() === fallback.ticker.toUpperCase();
  const nameAgrees = !name || normalizedName(name) === normalizedName(fallback.name);
  if (!tickerAgrees || !nameAgrees) return value;

  result.detectedCompanyTicker = ticker || fallback.ticker;
  result.detectedCompanyName = name || fallback.name;
  result.detectedCompanyConfidence = Math.max(
    typeof result.detectedCompanyConfidence === "number" ? result.detectedCompanyConfidence : 0,
    0.99,
  );
  return result;
}
