"use client";

import { useState } from "react";
import { ManualFinancialForm } from "@/components/ManualFinancialForm";
import { PdfExtractionPanel } from "@/components/PdfExtractionPanel";
import { ResumablePdfUpload } from "@/components/ResumablePdfUpload";

type Mode = "upload-v2" | "pipeline" | "manual";

type Props = {
  pdfUploadV2: boolean;
};

export function FinancialStatementsWorkspace({ pdfUploadV2 }: Props) {
  const [mode, setMode] = useState<Mode>(pdfUploadV2 ? "upload-v2" : "pipeline");

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">
          <div>
            <h2>Pilih cara input laporan keuangan</h2>
            <p className="form-hint">
              {pdfUploadV2
                ? "Upload V2 mengirim PDF langsung ke object storage. Pipeline digunakan untuk memonitor dan mereview hasil AI."
                : "Gunakan PDF + AI untuk ekstraksi otomatis, atau Manual untuk input langsung seperti MVP 1.2B."}
            </p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${pdfUploadV2 ? 3 : 2}, minmax(0, 1fr))`, gap: 10 }}>
          {pdfUploadV2 && (
            <button className={mode === "upload-v2" ? "btn" : "btn secondary"} type="button" onClick={() => setMode("upload-v2")}>
              Upload PDF V2
            </button>
          )}
          <button className={mode === "pipeline" ? "btn" : "btn secondary"} type="button" onClick={() => setMode("pipeline")}>
            {pdfUploadV2 ? "Pipeline & Review" : "PDF + AI Extraction"}
          </button>
          <button className={mode === "manual" ? "btn" : "btn secondary"} type="button" onClick={() => setMode("manual")}>
            Manual Input
          </button>
        </div>
      </div>

      {mode === "upload-v2" && pdfUploadV2 ? (
        <section className="card">
          <div className="header">
            <div>
              <h2>Resumable PDF Upload V2</h2>
              <p>Upload besar menggunakan single PUT atau multipart, dengan progress, retry, pause, dan resume.</p>
            </div>
            <span className="badge warning">INTERNAL TEST</span>
          </div>
          <ResumablePdfUpload onUploaded={() => setMode("pipeline")} />
        </section>
      ) : mode === "pipeline" ? (
        <PdfExtractionPanel />
      ) : (
        <section className="card">
          <h2>Manual Financial Input</h2>
          <p className="form-hint">Alur MVP 1.2B tetap dipertahankan: input → validasi → simpan ke PostgreSQL → cek dashboard.</p>
          <ManualFinancialForm />
        </section>
      )}
    </>
  );
}
