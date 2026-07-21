import { companies, kpis } from "@/lib/mock-data";
import { TrendChart } from "@/components/trend-chart";

export default function DashboardPage() {
  return <>
    <div className="header"><div><h1>Financial Dashboard</h1><p>Fondasi data laporan keuangan untuk analisis investasi jangka panjang.</p></div><span className="badge">MVP 1 • Database</span></div>
    <section className="grid kpi-grid">{kpis.map(k => <article className="card" key={k.label}><div className="kpi-label">{k.label}</div><div className="kpi-value">{k.value}</div><div className="kpi-change">{k.change}</div></article>)}</section>
    <section className="grid two-col">
      <article className="card"><h3>Revenue & Net Profit Trend</h3><TrendChart /></article>
      <article className="card"><h3>Companies</h3><table className="table"><tbody>{companies.map(c=><tr key={c.ticker}><td><span className="ticker">{c.ticker}</span><div className="note">{c.name}</div></td><td>{c.status}</td></tr>)}</tbody></table></article>
    </section>
  </>;
}
