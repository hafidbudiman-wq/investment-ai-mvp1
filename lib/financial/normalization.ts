const EMPTY_TOKENS = new Set(["", "-", "--", "—", "–", "nil", "n/a"]);

export function parseFinancialNumber(raw: string): number | null {
  let value = raw.trim().replace(/\s+/g, "");
  if (EMPTY_TOKENS.has(value.toLowerCase())) return null;

  const parenthesized = /^\(.*\)$/.test(value);
  value = value.replace(/^\(|\)$/g, "").replace(/[^0-9,.-]/g, "");
  if (!value || value === "." || value === ",") return null;

  const explicitNegative = value.startsWith("-");
  value = value.replace(/-/g, "");
  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalIndex = Math.max(lastDot, lastComma);
    const decimalDigits = value.length - decimalIndex - 1;
    const decimalSeparator = decimalDigits === 3 ? null : value[decimalIndex];
    value = decimalSeparator
      ? value.slice(0, decimalIndex).replace(/[.,]/g, "") + "." + value.slice(decimalIndex + 1)
      : value.replace(/[.,]/g, "");
  } else {
    const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (separator) {
      const pieces = value.split(separator);
      const looksGrouped = pieces.length > 2 || (pieces.length === 2 && pieces[1].length === 3 && pieces[0].length >= 1);
      value = looksGrouped ? pieces.join("") : `${pieces[0]}.${pieces[1]}`;
    }
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parenthesized || explicitNegative ? -Math.abs(parsed) : parsed;
}

export function normalizeUnitScale(value: string | null | undefined): number | null {
  const normalized = (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return null;
  if (/(triliun|trillion)/.test(normalized)) return 1_000_000_000_000;
  if (/(miliar|billion)/.test(normalized)) return 1_000_000_000;
  if (/(juta|million)/.test(normalized)) return 1_000_000;
  if (/(ribu|thousand)/.test(normalized)) return 1_000;
  if (/(satuan|unit)/.test(normalized)) return 1;
  return null;
}

export function normalizeCurrency(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if (/USD|US\$|DOLLAR AS/.test(normalized)) return "USD";
  if (/IDR|RUPIAH|^RP$/.test(normalized)) return "IDR";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export function freeCashFlow(operatingCashFlow: number, negativeCapex: number) {
  if (negativeCapex > 0) throw new Error("CAPEX must follow the canonical cash-outflow-negative convention.");
  return operatingCashFlow + negativeCapex;
}
