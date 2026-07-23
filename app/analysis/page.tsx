import { AnalysisSelector } from "@/components/AnalysisSelector";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function n(value: unknown) { return value == null ? null : Number(value); }
function pct(value: number | null) { return value == null || !Number.isFinite(value) ? "N/A" : `${value.toFixed(1)}%`; }
function multiple(value: number | null) { return value == null || !Number.isFinite(value) ? "N/A" : `${value.toFixed(2)}x`; }

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ reportId?: string }> }) {
  const params = await searchParams;
  const reports = await prisma.financialReport.findMany({ include: { company: true }, orderBy: [{ year: "desc" }, { company: { ticker: "asc" } }] }).catch(() => []);
  const selected = reports.find((report) => report.id === params.reportId) ?? reports[0];

  if (!selected) return <><div className="header"><div><h1>Fundamental Analysis</h1><p>Belum ada laporan keuangan untuk dianalisis.</p></div></div></>;

  const revenue = n(selected.revenue);
  const netProfit = n(selected.netProfit);
  const assets = n(selected.totalAssets);
  const liabilities = n(selected.totalLiabilities);
  const equity = n(selected.equity);
  const ocf = n(selected.operatingCashFlow);
  const netMargin = revenue ? (netProfit! / revenue) * 100 : null;
  const roe = equity ? (netProfit! / equity) * 100 : null;
  const roa = assets ? (netProfit! / assets) * 100 : null;
  const debtEquity = equity ? liabilities! / equity : null;
  const ocfProfit = netProfit ? ocf! / netProfit : null;
  const debtAssets = assets ? (liabilities! / assets) * 100 : null;

  const ratios = [
    ["Net Profit Margin", pct(netMargin), netMargin != null && netMargin > 10 ? "Healthy" : "Monitor"],
    ["ROE", pct(roe), roe != null && roe > 12 ? "Healthy" : "Monitor"],
    ["ROA", pct(roa), roa != null && roa > 5 ? "Healthy" : "Monitor"],
    ["Debt to Equity", multiple(debtEquity), debtEquity != null && debtEquity < 1 ? "Healthy" : "Monitor"],
    ["Liabilities / Assets", pct(debtAssets), debtAssets != null && debtAssets < 60 ? "Healthy" : "Monitor"],
    ["OCF / Net Profit", multiple(ocfProfit), ocfProfit != null && ocfProfit >= 1 ? "Healthy" : "Monitor"],
  ];

  const options = reports.map((report) => ({ id: report.id, label: `${report.company.ticker} · ${report.period} ${report.year}` }));

  return <>
    <div className="header"><div><h1>Fundamental Analysis</h1><p>Analisis otomatis dari data laporan yang tersimpan di PostgreSQL. Pilih perusahaan/periode untuk membandingkan hasil.</p></div><AnalysisSelector options={options} value={selected.id} /></div>
    <div className="analysis-context card"><b>{selected.company.ticker} — {selected.company.name}</b><span>{selected.period} {selected.year} · Status: {selected.status}</span></div>
    <div style={{height:16}} />
    <div className="grid cards">{ratios.map((ratio) => <div className="card" key={ratio[0]}><div className="metric-label">{ratio[0]}</div><div className="metric">{ratio[1]}</div><span className={`status ${ratio[2] === "Monitor" ? "review" : ""}`}>{ratio[2]}</span></div>)}</div>
    <div style={{height:16}} />
    <div className="callout">Growth YoY belum dihitung pada layar ini karena membutuhkan minimal dua periode comparable untuk perusahaan yang sama. Setelah data FY/Q yang berurutan tersedia, modul growth akan menghitung Revenue Growth, Profit Growth, Asset Growth, Equity Growth, dan OCF Growth.</div>
  </>;
}
