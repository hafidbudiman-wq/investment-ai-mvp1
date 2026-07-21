export type ValidationInput = {
  totalAssets: number; totalLiabilities: number; equity: number;
  revenue: number; previousRevenue?: number; receivables: number; previousReceivables?: number;
  netProfit: number; operatingCashFlow: number;
};
export function validateFinancials(x: ValidationInput) {
  const warnings: string[] = [];
  const balanceGap = Math.abs(x.totalAssets - (x.totalLiabilities + x.equity));
  if (balanceGap > Math.max(1, x.totalAssets * 0.001)) warnings.push("Total assets tidak sama dengan liabilities + equity.");
  if (x.netProfit > 0 && x.operatingCashFlow / x.netProfit < 0.6) warnings.push("Operating cash flow jauh di bawah net profit.");
  if (x.previousRevenue && x.previousReceivables && x.revenue < x.previousRevenue && x.receivables > x.previousReceivables * 1.1) warnings.push("Revenue turun tetapi piutang naik lebih dari 10%.");
  if (!Number.isFinite(x.totalAssets) || x.totalAssets <= 0) warnings.push("Total assets belum valid.");
  return warnings;
}
