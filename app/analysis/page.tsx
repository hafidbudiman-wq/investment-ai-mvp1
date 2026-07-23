import { AnalysisSelector } from "@/components/AnalysisSelector";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function n(value: unknown) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function pct(value: number | null) { return value == null ? "N/A" : `${value.toFixed(1)}%`; }
function multiple(value: number | null) { return value == null ? "N/A" : `${value.toFixed(2)}x`; }

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ reportId?: string }> }) {
  const params = await searchParams;
  const reports = await prisma.financialReport.findMany({
    include: {
      company: true,
      entries: { include: { canonicalAccount: true } },
    },
    orderBy: [{ year: "desc" }, { company: { ticker: "asc" } }],
  }).catch(() => []);

  const selected = reports.find((report) => report.id === params.reportId) ?? reports[0];
  if (!selected) {
    return <div className="header"><div><h1>Fundamental Analysis</h1><p>Belum ada laporan keuangan untuk dianalisis.</p></div></div>;
  }

  const values = new Map(selected.entries.map((entry) => [entry.canonicalAccount.code, n(entry.value)]));
  const revenue = values.get("REV") ?? null;
  const netProfit = values.get("NET_PROFIT") ?? null;
  const assets = values.get("TOTAL_ASSETS") ?? null;
  const liabilities = values.get("TOTAL_LIAB") ?? null;
  const equity = values.get("EQUITY") ?? null;
  const ocf = values.get("OCF") ?? null;

  const netMargin = revenue && netProfit != null ? (netProfit / revenue) * 100 : null;
  const roe = equity && netProfit != null ? (netProfit / equity) * 100 : null;
  const roa = assets && netProfit != null ? (netProfit / assets) * 100 : null;
  const debtEquity = equity && liabilities != null ? liabilities / equity : null;
  const debtAssets = assets && liabilities != null ? (liabilities / assets) * 100 : null;
  const ocfProfit = netProfit && ocf != null ? ocf / netProfit : null;

  const ratios = [
    ["Net Profit Margin", pct(netMargin), netMargin != null && netMargin > 10 ? "Healthy" : "Monitor"],
    ["ROE", pct(roe), roe != null && roe > 12 ? "Healthy" : "Monitor"],
    ["ROA", pct(roa), roa != null && roa > 5 ? "Healthy" : "Monitor"],
    ["Debt to Equity", multiple(debtEquity), debtEquity != null && debtEquity < 1 ? "Healthy" : "Monitor"],
    ["Liabilities / Assets", pct(debtAssets), debtAssets != null && debtAssets < 60 ? "Healthy" : "Monitor"],
    ["OCF / Net Profit", multiple(ocfProfit), ocfProfit != null && ocfProfit >= 1 ? "Healthy" : "Monitor"],
  ] as const;

  const options = reports.map((report) => ({
    id: report.id,
    label: `${report.company.ticker} · ${report.periodType} ${report.year}`,
  }));

  return <>
    <div className="header">
      <div><h1>Fundamental Analysis</h1><p>Analisis otomatis dari data laporan yang tersimpan di PostgreSQL.</p></div>
      <AnalysisSelector options={options} value={selected.id} />
    </div>
    <div className="analysis-context card"><b>{selected.company.ticker} — {selected.company.name}</b><span>{selected.periodType} {selected.year} · Status: {selected.status}</span></div>
    <div style={{ height: 16 }} />
    <div className="grid cards">{ratios.map((ratio) => <div className="card" key={ratio[0]}><div className="metric-label">{ratio[0]}</div><div className="metric">{ratio[1]}</div><span className={`status ${ratio[2] === "Monitor" ? "review" : ""}`}>{ratio[2]}</span></div>)}</div>
    <div style={{ height: 16 }} />
    <div className="callout">Growth YoY belum dihitung karena membutuhkan minimal dua periode comparable untuk perusahaan yang sama.</div>
  </>;
}
