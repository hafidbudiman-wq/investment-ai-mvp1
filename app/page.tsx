import { companies } from "@/lib/mock-data";

export default function Dashboard() {
  return <>
    <section className="card hero">
      <div className="kicker">MVP 1 · Financial Data Foundation</div>
      <div className="header"><div><h1>Investment AI – Stock Analysis Platform</h1><p>Upload, verifikasi, simpan, bandingkan, dan analisis laporan keuangan secara terstruktur.</p></div><button className="btn">Upload Statement</button></div>
    </section>
    <div style={{height:16}}/>
    <section className="grid cards">
      <div className="card"><div className="metric-label">Total Companies</div><div className="metric">{companies.length}</div></div>
      <div className="card"><div className="metric-label">Financial Reports</div><div className="metric">25</div></div>
      <div className="card"><div className="metric-label">Pending Review</div><div className="metric warning">2</div></div>
      <div className="card"><div className="metric-label">Data Warnings</div><div className="metric danger">4</div></div>
    </section>
    <div style={{height:16}}/>
    <section className="grid two">
      <div className="card"><h2>Companies</h2><div className="table-wrap"><table><thead><tr><th>Ticker</th><th>Company</th><th>Sector</th><th>Reports</th><th>Status</th></tr></thead><tbody>{companies.map(c=><tr key={c.ticker}><td><b>{c.ticker}</b></td><td>{c.name}</td><td>{c.sector}</td><td>{c.reports}</td><td><span className={`status ${c.status!=="Complete"?"review":""}`}>{c.status}</span></td></tr>)}</tbody></table></div></div>
      <div className="card"><h2>Recent Activity</h2><p><b>ICBP</b> FY 2025 uploaded</p><p><b>BTPS</b> account mapping needs review</p><p><b>SMRA</b> financial report validated</p><p><b>MEDC</b> missing cash-flow values</p></div>
    </section>
  </>;
}
