import { FinancialTrendChart } from "@/components/FinancialTrendChart";
import { TrendSelector } from "@/components/TrendSelector";
import { periodLabel } from "@/lib/financial/trend-periods";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Entry = { canonicalAccount: { code: string; name: string }; normalizedValue: unknown; value: unknown; scale: number; currency: string };

const KEY_FACTS = [
  ["REV", "Revenue"], ["GROSS_PROFIT", "Gross Profit"], ["OPERATING_PROFIT", "Operating Profit"],
  ["NET_PROFIT_PARENT", "Net Profit Parent"], ["OCF", "Operating Cash Flow"], ["CAPEX", "CAPEX"],
  ["FCF", "Free Cash Flow"], ["TOTAL_DEBT", "Total Debt"], ["EQUITY_PARENT", "Equity Parent"],
  ["SHARES_OUTSTANDING", "Shares Outstanding"], ["EPS_BASIC", "Basic EPS"],
] as const;

function values(entries: Entry[]): Map<string, number> {
  return new Map(entries.flatMap((entry) => {
    const normalized = Number(entry.normalizedValue ?? Number(entry.value) * entry.scale);
    return Number.isFinite(normalized) ? [[entry.canonicalAccount.code, normalized] as const] : [];
  }));
}

function compact(value: number | undefined, currency: string, code?: string): string {
  if (value == null) return "—";
  if (code?.includes("SHARES")) return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
  if (code?.startsWith("EPS")) return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 5 }).format(value);
  return `${currency} ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  return numerator == null || denominator == null || denominator === 0 ? null : numerator / denominator;
}

const percent = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

export default async function FinancialTrendsPage({ searchParams }: { searchParams: Promise<{ ticker?: string }> }) {
  const params = await searchParams;
  const companies = await prisma.company.findMany({
    where: { reports: { some: { status: "VERIFIED" } } },
    select: { ticker: true },
    orderBy: { ticker: "asc" },
  }).catch(() => []);
  const tickers = companies.map((company) => company.ticker);
  const ticker = tickers.includes(params.ticker ?? "") ? params.ticker! : tickers[0];

  if (!ticker) return <div className="header"><div><h1>Financial Trends</h1><p>Belum ada laporan VERIFIED untuk ditampilkan.</p></div></div>;

  const reports = await prisma.financialReport.findMany({
    where: { status: "VERIFIED", company: { ticker } },
    include: {
      company: true,
      entries: { where: { isVerified: true, reviewStatus: "VERIFIED" }, include: { canonicalAccount: true } },
    },
    orderBy: [{ periodEnd: "asc" }],
  });
  const withValues = reports.map((report) => ({ report, facts: values(report.entries) }));
  const latest = withValues.at(-1);
  const currency = latest?.report.company.currency ?? "IDR";
  const latestFacts = latest?.facts ?? new Map<string, number>();
  const chartPoints = withValues.map(({ report, facts }) => ({
    period: `${periodLabel(report.periodType)} ${report.year}`,
    revenue: facts.get("REV") ?? null,
    grossProfit: facts.get("GROSS_PROFIT") ?? null,
    netProfitParent: facts.get("NET_PROFIT_PARENT") ?? null,
    ocf: facts.get("OCF") ?? null,
    fcf: facts.get("FCF") ?? null,
  }));
  const cashConversion = ratio(latestFacts.get("OCF"), latestFacts.get("NET_PROFIT_PARENT"));
  const bvps = ratio(latestFacts.get("EQUITY_PARENT"), latestFacts.get("SHARES_OUTSTANDING"));
  const ratios = [
    ["Gross Margin", percent(ratio(latestFacts.get("GROSS_PROFIT"), latestFacts.get("REV")))],
    ["Operating Margin", percent(ratio(latestFacts.get("OPERATING_PROFIT"), latestFacts.get("REV")))],
    ["Net Margin Parent", percent(ratio(latestFacts.get("NET_PROFIT_PARENT"), latestFacts.get("REV")))],
    ["Cash Conversion", cashConversion == null ? "—" : `${cashConversion.toFixed(2)}x`],
    ["Book Value / Share", compact(bvps ?? undefined, currency, "EPS_BASIC")],
  ] as const;

  return <>
    <div className="header">
      <div><h1>Financial Trends</h1><p>Historical facts dan rasio terhitung dari data canonical VERIFIED—bukan ekstraksi rasio dari PDF.</p></div>
      <TrendSelector tickers={tickers} value={ticker} />
    </div>
    <div className="callout">Guard periode aktif: Q1, H1, 9M, dan FY tidak dibandingkan sebagai periode yang sama. YoY hanya dihitung bila periode pembanding identik; quarterly standalone baru dibentuk dari selisih cumulative yang lengkap.</div>
    <div style={{ height: 16 }} />
    <section className="grid cards trend-ratio-cards">{ratios.map(([name, value]) => <div className="card" key={name}><div className="metric-label">{name}</div><div className="metric trend-metric">{value}</div></div>)}</section>
    <div style={{ height: 16 }} />
    <section className="card"><h2>{ticker} · Historical Financial Facts</h2><FinancialTrendChart points={chartPoints} currency={currency} /></section>
    <div style={{ height: 16 }} />
    <section className="card"><h2>Canonical Trend Table</h2><div className="table-wrap"><table><thead><tr><th>Metric</th>{withValues.map(({ report }) => <th key={report.id}>{periodLabel(report.periodType)} {report.year}</th>)}</tr></thead><tbody>{KEY_FACTS.map(([code, label]) => <tr key={code}><td><b>{label}</b><br /><small>{code}</small></td>{withValues.map(({ report, facts }) => <td key={report.id}>{compact(facts.get(code), currency, code)}</td>)}</tr>)}</tbody></table></div></section>
  </>;
}
