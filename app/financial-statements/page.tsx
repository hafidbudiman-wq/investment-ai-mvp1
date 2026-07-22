import { ManualFinancialForm } from "@/components/ManualFinancialForm";

export const dynamic = "force-dynamic";

export default function StatementsPage() {
  return (
    <>
      <div className="header">
        <div>
          <h1>Financial Statements</h1>
          <p>Uji alur manual terlebih dahulu: input → validasi → simpan ke PostgreSQL → cek dashboard.</p>
        </div>
        <button className="btn secondary" type="button" disabled title="Upload PDF / Excel akan dibuat setelah manual input berhasil.">
          Upload PDF / Excel — Next
        </button>
      </div>

      <section className="grid two">
        <div className="card">
          <h2>Manual Financial Input</h2>
          <p className="form-hint">Gunakan unit yang sama untuk seluruh angka, misalnya Rp miliar. Data dengan company, tahun, dan periode yang sama akan diperbarui.</p>
          <ManualFinancialForm />
        </div>

        <div className="card">
          <h2>Target Uji Pertama</h2>
          <p>Gunakan data contoh yang seimbang agar status menjadi <b>VERIFIED</b>.</p>
          <div className="test-data">
            <div><span>Company</span><b>ICBP</b></div>
            <div><span>Period</span><b>FY 2025</b></div>
            <div><span>Revenue</span><b>250</b></div>
            <div><span>Net Profit</span><b>100</b></div>
            <div><span>Total Assets</span><b>500</b></div>
            <div><span>Total Liabilities</span><b>200</b></div>
            <div><span>Equity</span><b>300</b></div>
            <div><span>Operating Cash Flow</span><b>120</b></div>
          </div>
          <div className="callout">Pemeriksaan utama: Total Assets harus sama dengan Total Liabilities + Equity.</div>
          <p>Setelah berhasil, buka Dashboard. Financial Reports dan laporan ICBP harus berubah dari 0 menjadi 1.</p>
        </div>
      </section>
    </>
  );
}
