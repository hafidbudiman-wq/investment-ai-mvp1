import { MappingManager } from "@/components/MappingManager";
import { CanonicalAccountManager, type CanonicalAccountItem } from "@/components/CanonicalAccountManager";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  const [reports, accounts, mappings] = await Promise.all([
    prisma.financialReport.findMany({ include: { company: true, warnings: { where: { resolved: false } } }, orderBy: [{ year: "desc" }, { company: { ticker: "asc" } }], take: 20 }).catch(() => []),
    prisma.canonicalAccount.findMany({ where: { isActive: true }, orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }], select: { id: true, code: true, name: true, displayNameId: true, description: true, definition: true, investorMeaning: true, aliases: true, relatedMetrics: true, positiveSignals: true, redFlags: true, sectorNotes: true, sourceRefs: true, statementType: true, valueNature: true, normalBalance: true, isCalculated: true, formula: true } }).catch(() => []),
    prisma.accountMapping.findMany({ include: { canonicalAccount: { select: { id: true, name: true } } }, orderBy: { sourceLabel: "asc" } }).catch(() => []),
  ]);

  const accountItems = accounts as CanonicalAccountItem[];
  const mappingItems = mappings.map((mapping) => ({ id: mapping.id, reported: mapping.sourceLabel, canonical: mapping.canonicalAccount.name, canonicalAccountId: mapping.canonicalAccount.id }));

  return <>
    <div className="header"><div><h1>Data Management</h1><p>MVP 1.2B1 · Investor Financial Dictionary, canonical mapping, quality checks, and validation.</p></div></div>
    <section className="card account-master-card"><div className="section-title"><div><h2>Investor Financial Dictionary</h2><p>Cari akun dengan bahasa Indonesia atau istilah laporan keuangan. Klik hasil untuk memahami arti, kegunaan bagi investor, rasio terkait, sinyal positif, red flag, dan sumber referensinya.</p></div></div><CanonicalAccountManager initialAccounts={accountItems} /></section>
    <div style={{ height: 16 }} />
    <section className="data-management-layout">
      <div className="card data-card"><div className="section-title"><div><h2>Account Mapping</h2><p>Contoh: Penjualan Neto → Revenue, Piutang Usaha → Accounts Receivable.</p></div></div><MappingManager initialMappings={mappingItems} accounts={accountItems} /></div>
      <div className="card validation-card"><h2>Validation Status</h2>{reports.length === 0 && <p>Belum ada laporan keuangan tersimpan.</p>}<div className="validation-list">{reports.map((report) => <div className="validation-item" key={report.id}><b>{report.company.ticker} · {report.periodType} {report.year}</b><span className={report.status === "VERIFIED" ? "positive" : "warning"}>{report.status === "VERIFIED" ? "✓ Verified" : "⚠ Review"}</span>{report.warnings.map((warning) => <small className="danger" key={warning.id}>⚠ {warning.message}</small>)}</div>)}</div></div>
    </section>
  </>;
}