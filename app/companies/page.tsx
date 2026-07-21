import AddCompanyForm from "@/components/AddCompanyForm";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CompaniesPage(){
  let companies: Awaited<ReturnType<typeof prisma.company.findMany>> = [];
  let connected = true;
  try {
    companies = await prisma.company.findMany({ orderBy: { ticker: "asc" } });
  } catch {
    connected = false;
  }

  return <>
    <div className="header"><div><h1>Companies</h1><p>Master data emiten untuk laporan keuangan dan analisis.</p></div><AddCompanyForm /></div>
    {!connected && <div className="callout">PostgreSQL belum tersambung. Tambahkan DATABASE_URL di Railway lalu redeploy.</div>}
    <div style={{height:14}} />
    <div className="card table-wrap"><table><thead><tr><th>Ticker</th><th>Name</th><th>Sector</th><th>Currency</th><th>Status</th></tr></thead><tbody>
      {companies.map(c=><tr key={c.id}><td><b>{c.ticker}</b></td><td>{c.name}</td><td>{c.sector ?? "-"}</td><td>{c.currency}</td><td><span className="status">Active</span></td></tr>)}
      {connected && companies.length === 0 && <tr><td colSpan={5}>Belum ada data. Jalankan seed atau tambahkan perusahaan.</td></tr>}
    </tbody></table></div>
  </>;
}