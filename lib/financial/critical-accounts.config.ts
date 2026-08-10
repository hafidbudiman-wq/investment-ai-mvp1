export type CriticalAccountDefinition = {
  code: string;
  nameId: string;
  nameEn: string;
  aliases: readonly string[];
  statementType: "INCOME_STATEMENT" | "BALANCE_SHEET" | "CASH_FLOW";
  aggregationRule: "DIRECT_TOTAL" | "DIRECT_OR_DERIVED" | "SUM_COUNTERPARTIES" | "SUM_DEBT_COMPONENTS" | "SUM_CAPEX_COMPONENTS" | "DERIVED";
  signConvention: "POSITIVE" | "EXPENSE_POSITIVE" | "CASH_INFLOW_POSITIVE" | "CASH_OUTFLOW_NEGATIVE";
  unit: "DOCUMENT_UNIT" | "PER_SHARE" | "SHARES";
  periodType: "FLOW" | "STOCK";
  validationRules: readonly string[];
};

// Product owner approved the original 13 facts and explicitly requested these
// six investor-critical additions: assets, liabilities, equity, parent equity,
// shares outstanding, and basic EPS.
export const CRITICAL_ACCOUNTS_STATUS = "APPROVED_MVP1_CORE_19" as const;

export const CRITICAL_ACCOUNTS = [
  { code: "REV", nameId: "Pendapatan / Penjualan Neto", nameEn: "Revenue / Net Sales", aliases: ["pendapatan", "penjualan neto", "net sales", "revenue"], statementType: "INCOME_STATEMENT", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "FLOW", validationRules: ["current-period", "primary-statement-total", "non-negative"] },
  { code: "COGS", nameId: "Beban Pokok Penjualan", nameEn: "Cost of Goods Sold", aliases: ["beban pokok penjualan", "beban pokok pendapatan", "cost of goods sold", "cost of revenue", "cost of sales"], statementType: "INCOME_STATEMENT", aggregationRule: "DIRECT_TOTAL", signConvention: "EXPENSE_POSITIVE", unit: "DOCUMENT_UNIT", periodType: "FLOW", validationRules: ["current-period", "primary-statement-total", "non-negative"] },
  { code: "GROSS_PROFIT", nameId: "Laba Kotor", nameEn: "Gross Profit", aliases: ["laba bruto", "laba kotor", "gross profit"], statementType: "INCOME_STATEMENT", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "FLOW", validationRules: ["revenue-minus-cogs", "current-period"] },
  { code: "OPERATING_PROFIT", nameId: "Laba Usaha", nameEn: "Operating Profit", aliases: ["laba usaha", "laba operasi", "income from operations", "operating profit", "earnings before interest and tax", "ebit"], statementType: "INCOME_STATEMENT", aggregationRule: "DIRECT_OR_DERIVED", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "FLOW", validationRules: ["current-period", "prefer-primary-statement-total", "derive-ebit-only-when-direct-total-absent", "preserve-components"] },
  { code: "NET_PROFIT_PARENT", nameId: "Laba Pemilik Entitas Induk", nameEn: "Profit Attributable to Owners of Parent", aliases: ["pemilik entitas induk", "owners of the parent", "equity holders of the parent entity", "profit attributable to owners"], statementType: "INCOME_STATEMENT", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "FLOW", validationRules: ["parent-attributable-only", "current-period"] },
  { code: "EPS_BASIC", nameId: "Laba per Saham Dasar", nameEn: "Basic Earnings per Share", aliases: ["laba per saham dasar", "basic earnings per share", "basic eps", "earnings per share"], statementType: "INCOME_STATEMENT", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "PER_SHARE", periodType: "FLOW", validationRules: ["current-period", "parent-attributable", "full-amount-per-share", "scale-one"] },
  { code: "CASH", nameId: "Kas dan Setara Kas", nameEn: "Cash and Cash Equivalents", aliases: ["kas dan setara kas", "cash and cash equivalents"], statementType: "BALANCE_SHEET", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["period-end", "exclude-restricted-cash-unless-stated"] },
  { code: "AR", nameId: "Piutang Usaha", nameEn: "Trade Receivables", aliases: ["piutang usaha", "piutang dagang", "trade receivables", "trade accounts receivable"], statementType: "BALANCE_SHEET", aggregationRule: "SUM_COUNTERPARTIES", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["sum-third-and-related-parties", "avoid-subtotal-double-count", "net-of-allowance"] },
  { code: "INV", nameId: "Persediaan", nameEn: "Inventories", aliases: ["persediaan", "inventories", "inventory"], statementType: "BALANCE_SHEET", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["period-end", "net-of-allowance"] },
  { code: "TOTAL_ASSETS", nameId: "Total Aset", nameEn: "Total Assets", aliases: ["total aset", "jumlah aset", "total assets"], statementType: "BALANCE_SHEET", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["period-end", "primary-statement-total", "assets-equal-liabilities-plus-equity"] },
  { code: "AP", nameId: "Utang Usaha", nameEn: "Trade Payables", aliases: ["utang usaha", "utang dagang", "trade payables", "trade accounts payable"], statementType: "BALANCE_SHEET", aggregationRule: "SUM_COUNTERPARTIES", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["sum-third-and-related-parties", "avoid-subtotal-double-count"] },
  { code: "TOTAL_DEBT", nameId: "Total Utang Berbunga", nameEn: "Total Interest-bearing Debt", aliases: ["total pinjaman", "total borrowings", "interest-bearing debt", "utang berbunga"], statementType: "BALANCE_SHEET", aggregationRule: "SUM_DEBT_COMPONENTS", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["current-plus-non-current", "include-lease-liabilities", "exclude-trade-payables", "avoid-subtotal-double-count"] },
  { code: "TOTAL_LIAB", nameId: "Total Liabilitas", nameEn: "Total Liabilities", aliases: ["total liabilitas", "jumlah liabilitas", "total liabilities"], statementType: "BALANCE_SHEET", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["period-end", "primary-statement-total", "assets-equal-liabilities-plus-equity"] },
  { code: "EQUITY", nameId: "Total Ekuitas", nameEn: "Total Equity", aliases: ["total ekuitas", "jumlah ekuitas", "total equity"], statementType: "BALANCE_SHEET", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["period-end", "primary-statement-total", "assets-equal-liabilities-plus-equity"] },
  { code: "EQUITY_PARENT", nameId: "Ekuitas Pemilik Entitas Induk", nameEn: "Equity Attributable to Owners of Parent", aliases: ["ekuitas yang dapat diatribusikan kepada pemilik entitas induk", "ekuitas yang diatribusikan kepada pemilik entitas induk", "equity attributable to owners of the parent", "equity holders of the parent entity"], statementType: "BALANCE_SHEET", aggregationRule: "DIRECT_TOTAL", signConvention: "POSITIVE", unit: "DOCUMENT_UNIT", periodType: "STOCK", validationRules: ["period-end", "parent-attributable-only", "do-not-use-total-equity"] },
  { code: "SHARES_OUTSTANDING", nameId: "Saham Beredar", nameEn: "Outstanding Shares", aliases: ["jumlah saham beredar", "saham biasa beredar", "outstanding shares", "ordinary shares outstanding", "issued shares less treasury shares"], statementType: "BALANCE_SHEET", aggregationRule: "DIRECT_OR_DERIVED", signConvention: "POSITIVE", unit: "SHARES", periodType: "STOCK", validationRules: ["period-end", "full-share-count", "exclude-treasury-shares", "positive-integer", "scale-one"] },
  { code: "OCF", nameId: "Arus Kas Operasi", nameEn: "Operating Cash Flow", aliases: ["kas neto diperoleh dari aktivitas operasi", "arus kas dari aktivitas operasi", "net cash provided by operating activities", "cash flows from operating activities"], statementType: "CASH_FLOW", aggregationRule: "DIRECT_TOTAL", signConvention: "CASH_INFLOW_POSITIVE", unit: "DOCUMENT_UNIT", periodType: "FLOW", validationRules: ["current-period", "primary-statement-total", "preserve-sign"] },
  { code: "CAPEX", nameId: "Belanja Modal", nameEn: "Capital Expenditure", aliases: ["perolehan aset tetap", "pembelian aset tetap", "acquisition of fixed assets", "purchase of fixed assets", "capital expenditure"], statementType: "CASH_FLOW", aggregationRule: "SUM_CAPEX_COMPONENTS", signConvention: "CASH_OUTFLOW_NEGATIVE", unit: "DOCUMENT_UNIT", periodType: "FLOW", validationRules: ["current-period", "cash-outflow-negative", "preserve-components", "avoid-subtotal-double-count"] },
  { code: "FCF", nameId: "Arus Kas Bebas", nameEn: "Free Cash Flow", aliases: ["arus kas bebas", "free cash flow"], statementType: "CASH_FLOW", aggregationRule: "DERIVED", signConvention: "CASH_INFLOW_POSITIVE", unit: "DOCUMENT_UNIT", periodType: "FLOW", validationRules: ["ocf-plus-negative-capex", "same-period", "same-unit", "same-currency"] },
] as const satisfies readonly CriticalAccountDefinition[];

export const CRITICAL_ACCOUNT_BY_CODE: ReadonlyMap<string, CriticalAccountDefinition> = new Map(CRITICAL_ACCOUNTS.map((account) => [account.code, account]));

// Operating profit is the only safe omission because some issuers do not
// report a unique operating subtotal. Every other core fact must be GREEN
// before the run may be committed.
export const COMMIT_REQUIRED_ACCOUNT_CODES = CRITICAL_ACCOUNTS
  .filter((account) => account.code !== "OPERATING_PROFIT")
  .map((account) => account.code);
