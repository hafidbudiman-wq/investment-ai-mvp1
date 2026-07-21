import { PrismaClient, StatementType } from "@prisma/client";
const prisma = new PrismaClient();
async function main(){
  const accounts = [
    ["REV","Revenue",StatementType.INCOME_STATEMENT], ["COGS","Cost of Goods Sold",StatementType.INCOME_STATEMENT],
    ["NET_PROFIT","Net Profit",StatementType.INCOME_STATEMENT], ["CASH","Cash and Cash Equivalents",StatementType.BALANCE_SHEET],
    ["AR","Accounts Receivable",StatementType.BALANCE_SHEET], ["INV","Inventory",StatementType.BALANCE_SHEET],
    ["TOTAL_ASSETS","Total Assets",StatementType.BALANCE_SHEET], ["TOTAL_LIAB","Total Liabilities",StatementType.BALANCE_SHEET],
    ["EQUITY","Equity",StatementType.BALANCE_SHEET], ["OCF","Operating Cash Flow",StatementType.CASH_FLOW],
    ["CAPEX","Capital Expenditure",StatementType.CASH_FLOW]
  ] as const;
  for (const [code,name,statementType] of accounts) await prisma.canonicalAccount.upsert({where:{code},update:{name,statementType},create:{code,name,statementType}});
  for (const c of [
    {ticker:"ICBP",name:"Indofood CBP Sukses Makmur Tbk",sector:"Consumer Non-Cyclicals",subsector:"Processed Foods"},
    {ticker:"BTPS",name:"Bank BTPN Syariah Tbk",sector:"Financials",subsector:"Banks"},
    {ticker:"SMRA",name:"Summarecon Agung Tbk",sector:"Properties",subsector:"Real Estate"},
    {ticker:"MEDC",name:"Medco Energi Internasional Tbk",sector:"Energy",subsector:"Oil & Gas",currency:"USD"},
    {ticker:"POWR",name:"Cikarang Listrindo Tbk",sector:"Utilities",subsector:"Independent Power Producer"}
  ]) await prisma.company.upsert({where:{ticker:c.ticker},update:c,create:c});
}
main().finally(()=>prisma.$disconnect());
