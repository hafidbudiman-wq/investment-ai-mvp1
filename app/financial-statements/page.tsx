import { ManualFinancialForm } from "@/components/ManualFinancialForm";
import { ExcelImportPanel } from "@/components/ExcelImportPanel";

export const dynamic = "force-dynamic";

export default function StatementsPage() {
  return (
    <>
      <div className="header">
        <div>
          <h1>Financial Statements</h1>
          <p>Manual input tetap tersedia. MVP 1.2C menambahkan Excel → preview → mapping review sebelum data masuk PostgreSQL.</p>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <h2>Excel Import — MVP 1.2C</h2>
        <p className="form-hint">Upload Excel tidak langsung menulis database. InvestAI membaca file, menampilkan hasil ekstraksi dan status mapping, lalu user review terlebih dahulu.</p>
        <ExcelImportPanel />
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Manual Financial Input</h2>
          <p className="form-hint">Gunakan unit yang sama untuk seluruh angka, misalnya Rp miliar. Data dengan company, tahun, dan periode yang sama akan diperbarui.</p>
          <ManualFinancialForm />
        </div>

        <div className="card">
          <h2>Acceptance Flow</h2>
          <p>MVP 1.2C menggunakan safety gate sebelum save.</p>
          <div className="test-data">
            <div><span>1</span><b>Upload .xlsx / .xls</b></div>
            <div><span>2</span><b>Extract Account + Value</b></div>
            <div><span>3</span><b>Match Account Mapping</b></div>
            <div><span>4</span><b>Review mapped / unmapped</b></div>
            <div><span>5</span><b>Confirm before PostgreSQL</b></div>
          </div>
          <div className="callout">Pada PR pertama ini mode sengaja PREVIEW_ONLY. Tidak ada data Excel yang dapat merusak canonical database sebelum review flow kita uji.</div>
        </div>
      </section>
    </>
  );
}
