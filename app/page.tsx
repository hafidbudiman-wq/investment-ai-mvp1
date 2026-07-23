import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  let connected = true;
  let companies: Array<{id:string;ticker:string;name:string;sector:string|null;_count:{reports:number}}> = [];
  let reportCount = 0;
  let pendingCount = 0;
  let warningCount = 0;
  try {
    [companies, reportCount, pendingCount, warningCount] = await Promise.all([
      prisma.company.findMany({ include: { _count: { select: { reports: true } } }, orderBy: { ticker: "asc" }, take: 10 }),
      prisma.financialReport.count(),
      prisma.financialReport.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.dataWarning.count({ where: { resolved: false } }),
    ]);
  } catch {
    connected = false;
  }

  return <>
    <section className="card hero">
      <div className="kicker">MVP 1 · Financial Data Foundation</div>
      <div className="header"><div><h1>Investment AI – Stock Analysis Platform</h1><p>Upload, verifikasi, simpan, bandingkan, dan analisis laporan keuangan secara terstruktur.</p></div><Link className="btn" href="/financial-statements">Upload Statement</Link></div>
    </section>
    {!connected && <><div style={{height:16}}/><div className="callout">Database belum tersambung. Website tetap aktif, tetapi data dashboard belum berasal dari PostgreSQL.</div></>}
    <div style={{height:16}}/>
    <section className="grid cards">
      <div className="card"><div className="metric-label">Total Companies</div><div className="metric">{companies.length}</div></div>
      <div className="card"><div className="metric-label">Financial Reports</div><div className="metric">{reportCount}</div></div>
      <div className="card"><div className="metric-label">Pending Review</div><div className="metric warning">{pendingCount}</div></div>
      <div className="card"><div className="metric-label">Data Warnings</div><div className="metric danger">{warningCount}</div></div>
    </section>
    <div style={{height:16}}/>
    <section className="grid two">
      <div className="card"><h2>Companies</h2>
        <div className="desktop-table table-wrap"><table><thead><tr><th>Ticker</th><th>Company</th><th>Sector</th><th>Reports</th><th>Status</th></tr></thead><tbody>{companies.map(c=><tr key={c.id}><td><b>{c.ticker}</b></td><td>{c.name}</td><td>{c.sector ?? "-"}</td><td>{c._count.reports}</td><td><span className="status">Active</span></td></tr>)}{connected && companies.length===0 && <tr><td colSpan={5}>Database kosong. Jalankan seed data.</td></tr>}</tbody></table></div>
        <div className="company-list">{companies.map(c=><article className="company-item" key={c.id}><div className="company-item-top"><strong>{c.ticker}</strong><span className="status">Active</span></div><div className="company-name">{c.name}</div><div className="company-meta"><span>{c.sector ?? "-"}</span><span>{c._count.reports} report{c._count.reports === 1 ? "" : "s"}</span></div></article>)}{connected && companies.length===0 && <p>Database kosong. Jalankan seed data.</p>}</div>
      </div>
      <div className="card"><h2>Database Status</h2><p><b>{connected ? "PostgreSQL connected" : "PostgreSQL not connected"}</b></p><p>{connected ? "Dashboard sekarang membaca data asli dari database." : "Tambahkan DATABASE_URL dan jalankan Prisma db push serta seed."}</p></div>
    </section>
  </>;
}
