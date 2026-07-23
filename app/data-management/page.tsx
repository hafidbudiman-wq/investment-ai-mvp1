import { MappingManager } from "@/components/MappingManager";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const fallbackMappings = [
  { reported: "Penjualan Neto", canonical: "Revenue" },
  { reported: "Pendapatan Bersih", canonical: "Revenue" },
  { reported: "Beban Pokok Penjualan", canonical: "Cost of Goods Sold" },
  { reported: "Kas dan Setara Kas", canonical: "Cash" },
  { reported: "Piutang Usaha", canonical: "Accounts Receivable" },
];

export default async function DataPage() {
  const reports = await prisma.financialReport.findMany({
    include: { company: true, warnings: { where: { resolved: false } } },
    orderBy: [{ year: "desc" }, { company: { ticker: "asc" } }],
    take: 20,
  }).catch(() => []);

  return <>
    <div className="header"><div><h1>Data Management</h1><p>Account mapping, quality checks, editing, and audit trail.</p></div><MappingManager initialMappings={fallbackMappings} /></div>
    <section className="grid two">
      <div className="card"><h2>Account Mapping</h2><MappingManager initialMappings={fallbackMappings} /></div>
      <div className="card"><h2>Validation Status</h2>
        {reports.length === 0 && <p>Belum ada laporan keuangan tersimpan.</p>}
        <div className="validation-list">{reports.map((report) => <div className="validation-item" key={report.id}><b>{report.company.ticker} · {report.period} {report.year}</b><span className={report.status === "VERIFIED" ? "positive" : "warning"}>{report.status === "VERIFIED" ? "✓ Verified" : "⚠ Review"}</span>{report.warnings.map((warning) => <small className="danger" key={warning.id}>⚠ {warning.message}</small>)}</div>)}</div>
      </div>
    </section>
  </>;
}
