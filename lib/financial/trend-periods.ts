export type TrendPeriodType = "Q1" | "H1" | "Q3" | "FY" | "MONTHLY";

export type TrendPeriod = { year: number; periodType: TrendPeriodType; periodEnd?: Date | string | null };

const CUMULATIVE_MONTHS: Record<Exclude<TrendPeriodType, "MONTHLY">, number> = { Q1: 3, H1: 6, Q3: 9, FY: 12 };

function monthOf(period: TrendPeriod): number | null {
  if (!period.periodEnd) return null;
  const date = new Date(period.periodEnd);
  return Number.isNaN(date.getTime()) ? null : date.getUTCMonth();
}

export function periodLabel(periodType: TrendPeriodType): string {
  return periodType === "Q3" ? "9M" : periodType;
}

export function isComparablePeriod(current: TrendPeriod, previous: TrendPeriod): boolean {
  if (current.periodType !== previous.periodType || current.year !== previous.year + 1) return false;
  if (current.periodType !== "MONTHLY") return true;
  const currentMonth = monthOf(current);
  return currentMonth !== null && currentMonth === monthOf(previous);
}

export function comparableYoYGrowth(currentValue: number | null, previousValue: number | null, current: TrendPeriod, previous: TrendPeriod): number | null {
  if (currentValue === null || previousValue === null || previousValue === 0 || !isComparablePeriod(current, previous)) return null;
  return currentValue / previousValue - 1;
}

export function deriveStandaloneQuarter(
  current: { periodType: Exclude<TrendPeriodType, "MONTHLY">; value: number },
  previousCumulative?: { periodType: Exclude<TrendPeriodType, "MONTHLY">; value: number } | null,
): { quarter: "Q1" | "Q2" | "Q3" | "Q4"; value: number } | null {
  if (current.periodType === "Q1") return { quarter: "Q1", value: current.value };
  const expectedPrevious: Partial<Record<Exclude<TrendPeriodType, "MONTHLY">, Exclude<TrendPeriodType, "MONTHLY">>> = { H1: "Q1", Q3: "H1", FY: "Q3" };
  if (!previousCumulative || previousCumulative.periodType !== expectedPrevious[current.periodType]) return null;
  const quarter = current.periodType === "H1" ? "Q2" : current.periodType === "Q3" ? "Q3" : "Q4";
  return { quarter, value: current.value - previousCumulative.value };
}

export function cumulativeMonths(periodType: Exclude<TrendPeriodType, "MONTHLY">): number {
  return CUMULATIVE_MONTHS[periodType];
}
