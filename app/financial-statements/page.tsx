import { ManualFinancialForm } from "@/components/ManualFinancialForm";
import { PdfExtractionPanel } from "@/components/PdfExtractionPanel";

export const dynamic = "force-dynamic";

export default function StatementsPage() {
  return (
    <>
      <div className="header">
        <div>
          <h1>Financial Statements</h1>
          <p>Manual input tetap tersedia. PDF 1.2D diproses melalui staging dan review sebelum boleh masuk canonical database.</p>
        </div>
      </div>

      <PdfExtractionPanel />

      <section className="grid two">
        <div className="card">
          <h2>Manual Financial Input</h2>
          <p className="form-hint">Alur MVP 1.2B tetap dipertahankan: input → validasi → simpan ke PostgreSQL → cek dashboard.</p>
          <ManualFinancialForm />
        </div>

        <div className="card">
          <h2>Golden Rule 1.2D</h2>
          <p><b>AI boleh membaca dan mengusulkan. AI tidak boleh diam-diam mengubah canonical financial database.</b></p>
          <div className="callout">PDF → preprocessing → structure-aware chunking → extraction staging → mapping → review → validation → explicit canonical commit.</div>
          <p className="form-hint">Pada increment ini upload PDF masuk staging dan dilindungi checksum anti-duplikasi. Extraction/OCR dan commit canonical tetap berada di belakang review gate.</p>
        </div>
      </section>
    </>
  );
}
