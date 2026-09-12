import { Prisma } from "@prisma/client";

export type ParsedFinancialDecimal = {
  decimal: string;
  negative: boolean;
  zero: boolean;
};

const SPACE = /[\s\u00a0\u202f]/g;

/**
 * Parses statement text without ever passing the value through JavaScript
 * Number. Thousands separators are removed only when every trailing group has
 * three digits. A lone dash is an evidenced zero, not a missing value.
 */
export function parseFinancialDecimal(rawInput: string): ParsedFinancialDecimal | null {
  let raw = rawInput.normalize("NFKC").trim();
  if (/^[\-–—]$/.test(raw)) return { decimal: "0", negative: false, zero: true };

  const parenthesized = /^\s*\(.*\)\s*$/.test(raw);
  raw = raw
    .replace(/[()]/g, "")
    .replace(/^(?:Rp|IDR|USD|US\$|\$)\s*/i, "")
    .replace(/%$/, "")
    .replace(SPACE, "")
    .replace(/[−–—]/g, "-");

  const leadingNegative = raw.startsWith("-");
  if (leadingNegative) raw = raw.slice(1);
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return null;

  const separators = raw.match(/[.,]/g) ?? [];
  let canonical: string;
  if (!separators.length) {
    canonical = raw;
  } else {
    const pieces = raw.split(/[.,]/);
    const thousands = pieces.length > 1 && pieces.slice(1).every((piece) => piece.length === 3);
    if (thousands) {
      canonical = pieces.join("");
    } else if (separators.length === 1 && pieces[1].length > 0) {
      canonical = `${pieces[0]}.${pieces[1]}`;
    } else {
      return null;
    }
  }

  const decimal = new Prisma.Decimal(canonical);
  const signed = parenthesized || leadingNegative ? decimal.negated() : decimal;
  return { decimal: signed.toFixed(), negative: signed.isNegative(), zero: signed.isZero() };
}

export function sumFinancialDecimals(values: readonly string[]): string {
  return values.reduce((sum, value) => sum.plus(new Prisma.Decimal(value)), new Prisma.Decimal(0)).toFixed();
}
