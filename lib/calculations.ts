export type FinancialInput = {
  revenue: number; cogs: number; operatingProfit: number; netProfit: number;
  totalAssets: number; equity: number; debt: number; cash: number;
  operatingCashFlow: number; capex: number; interestExpense: number;
  currentAssets: number; currentLiabilities: number; receivables: number;
  inventory: number; payables: number;
};
const safe = (a:number,b:number) => b === 0 ? null : a / b;
export function calculateRatios(x: FinancialInput) {
  const grossProfit = x.revenue - x.cogs;
  const netDebt = x.debt - x.cash;
  return {
    grossMargin: safe(grossProfit, x.revenue),
    operatingMargin: safe(x.operatingProfit, x.revenue),
    netMargin: safe(x.netProfit, x.revenue),
    roa: safe(x.netProfit, x.totalAssets),
    roe: safe(x.netProfit, x.equity),
    currentRatio: safe(x.currentAssets, x.currentLiabilities),
    debtToEquity: safe(x.debt, x.equity),
    netDebt,
    interestCoverage: safe(x.operatingProfit, x.interestExpense),
    ocfToNetProfit: safe(x.operatingCashFlow, x.netProfit),
    freeCashFlow: x.operatingCashFlow - x.capex,
    receivableDays: safe(x.receivables * 365, x.revenue),
    inventoryDays: safe(x.inventory * 365, x.cogs),
    payableDays: safe(x.payables * 365, x.cogs),
    cashConversionCycle: (safe(x.receivables * 365, x.revenue) ?? 0) + (safe(x.inventory * 365, x.cogs) ?? 0) - (safe(x.payables * 365, x.cogs) ?? 0)
  };
}
