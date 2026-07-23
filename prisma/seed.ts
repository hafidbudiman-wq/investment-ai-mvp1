import { PrismaClient, StatementType, ValueNature } from "@prisma/client";

const prisma = new PrismaClient();

type AccountSeed = [string, string, StatementType, ValueNature, number];

const accounts: AccountSeed[] = [
  ["REV", "Revenue", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 100],
  ["COGS", "Cost of Goods Sold", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 110],
  ["GROSS_PROFIT", "Gross Profit", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 120],
  ["SGA", "Selling, General and Administrative Expense", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 130],
  ["OPERATING_PROFIT", "Operating Profit / EBIT", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 140],
  ["EBITDA", "EBITDA", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 150],
  ["FINANCE_INCOME", "Finance Income", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 160],
  ["FINANCE_COST", "Finance Cost", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 170],
  ["FX_GAIN_LOSS", "Foreign Exchange Gain / Loss", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 180],
  ["PRETAX_PROFIT", "Profit Before Tax", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 190],
  ["TAX_EXPENSE", "Income Tax Expense", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 200],
  ["NET_PROFIT", "Net Profit", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 210],
  ["NET_PROFIT_PARENT", "Net Profit Attributable to Owners of Parent", StatementType.INCOME_STATEMENT, ValueNature.FLOW, 220],
  ["EPS_BASIC", "Basic Earnings per Share", StatementType.INCOME_STATEMENT, ValueNature.PER_SHARE, 230],
  ["EPS_DILUTED", "Diluted Earnings per Share", StatementType.INCOME_STATEMENT, ValueNature.PER_SHARE, 240],

  ["CASH", "Cash and Cash Equivalents", StatementType.BALANCE_SHEET, ValueNature.STOCK, 300],
  ["SHORT_TERM_INVESTMENTS", "Short-term Investments", StatementType.BALANCE_SHEET, ValueNature.STOCK, 310],
  ["AR", "Accounts Receivable", StatementType.BALANCE_SHEET, ValueNature.STOCK, 320],
  ["OTHER_RECEIVABLES", "Other Receivables", StatementType.BALANCE_SHEET, ValueNature.STOCK, 330],
  ["INV", "Inventory", StatementType.BALANCE_SHEET, ValueNature.STOCK, 340],
  ["CURRENT_ASSETS", "Total Current Assets", StatementType.BALANCE_SHEET, ValueNature.STOCK, 350],
  ["PPE", "Property, Plant and Equipment", StatementType.BALANCE_SHEET, ValueNature.STOCK, 360],
  ["RIGHT_OF_USE_ASSETS", "Right-of-use Assets", StatementType.BALANCE_SHEET, ValueNature.STOCK, 370],
  ["GOODWILL", "Goodwill", StatementType.BALANCE_SHEET, ValueNature.STOCK, 380],
  ["INTANGIBLE_ASSETS", "Intangible Assets", StatementType.BALANCE_SHEET, ValueNature.STOCK, 390],
  ["LONG_TERM_INVESTMENTS", "Long-term Investments", StatementType.BALANCE_SHEET, ValueNature.STOCK, 400],
  ["TOTAL_ASSETS", "Total Assets", StatementType.BALANCE_SHEET, ValueNature.STOCK, 410],
  ["AP", "Accounts Payable", StatementType.BALANCE_SHEET, ValueNature.STOCK, 420],
  ["SHORT_TERM_DEBT", "Short-term Debt", StatementType.BALANCE_SHEET, ValueNature.STOCK, 430],
  ["CURRENT_LIAB", "Total Current Liabilities", StatementType.BALANCE_SHEET, ValueNature.STOCK, 440],
  ["LONG_TERM_DEBT", "Long-term Debt", StatementType.BALANCE_SHEET, ValueNature.STOCK, 450],
  ["LEASE_LIABILITIES", "Lease Liabilities", StatementType.BALANCE_SHEET, ValueNature.STOCK, 460],
  ["TOTAL_DEBT", "Total Debt", StatementType.BALANCE_SHEET, ValueNature.STOCK, 470],
  ["TOTAL_LIAB", "Total Liabilities", StatementType.BALANCE_SHEET, ValueNature.STOCK, 480],
  ["EQUITY", "Total Equity", StatementType.BALANCE_SHEET, ValueNature.STOCK, 490],
  ["EQUITY_PARENT", "Equity Attributable to Owners of Parent", StatementType.BALANCE_SHEET, ValueNature.STOCK, 500],
  ["RETAINED_EARNINGS", "Retained Earnings", StatementType.BALANCE_SHEET, ValueNature.STOCK, 510],

  ["OCF", "Operating Cash Flow", StatementType.CASH_FLOW, ValueNature.FLOW, 600],
  ["CAPEX", "Capital Expenditure", StatementType.CASH_FLOW, ValueNature.FLOW, 610],
  ["ICF", "Investing Cash Flow", StatementType.CASH_FLOW, ValueNature.FLOW, 620],
  ["CFF", "Financing Cash Flow", StatementType.CASH_FLOW, ValueNature.FLOW, 630],
  ["DIVIDENDS_PAID", "Dividends Paid", StatementType.CASH_FLOW, ValueNature.FLOW, 640],
  ["DEBT_ISSUED", "Debt Issued", StatementType.CASH_FLOW, ValueNature.FLOW, 650],
  ["DEBT_REPAID", "Debt Repaid", StatementType.CASH_FLOW, ValueNature.FLOW, 660],
  ["FCF", "Free Cash Flow", StatementType.CASH_FLOW, ValueNature.FLOW, 670],
  ["NET_CHANGE_CASH", "Net Change in Cash", StatementType.CASH_FLOW, ValueNature.FLOW, 680],
];

async function main() {
  for (const [code, name, statementType, valueNature, sortOrder] of accounts) {
    await prisma.canonicalAccount.upsert({
      where: { code },
      update: { name, statementType, valueNature, sortOrder, isActive: true },
      create: { code, name, statementType, valueNature, sortOrder },
    });
  }

  for (const company of [
    { ticker: "ICBP", name: "Indofood CBP Sukses Makmur Tbk", sector: "Consumer Non-Cyclicals", subsector: "Processed Foods" },
    { ticker: "BTPS", name: "Bank BTPN Syariah Tbk", sector: "Financials", subsector: "Banks" },
    { ticker: "SMRA", name: "Summarecon Agung Tbk", sector: "Properties", subsector: "Real Estate" },
    { ticker: "MEDC", name: "Medco Energi Internasional Tbk", sector: "Energy", subsector: "Oil & Gas", currency: "USD" },
    { ticker: "POWR", name: "Cikarang Listrindo Tbk", sector: "Utilities", subsector: "Independent Power Producer" },
  ]) {
    await prisma.company.upsert({ where: { ticker: company.ticker }, update: company, create: company });
  }

  console.log(`Seeded ${accounts.length} canonical accounts and 5 companies.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
