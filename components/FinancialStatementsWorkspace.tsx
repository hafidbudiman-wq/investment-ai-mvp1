"use client";

import { useState } from "react";
import { ManualFinancialForm } from "@/components/ManualFinancialForm";
import { PdfExtractionPanel } from "@/components/PdfExtractionPanel";

type Mode = "pdf" | "manual";

export function FinancialStatementsWorkspace() {
  const [mode, setMode] = useState<Mode>("pdf");

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">
          <div>
            <h2>Pilih cara input laporan keuangan</h2>
            <p className="form-hint">Gunakan PDF + AI untuk ekstraksi otomatis, atau Manual untuk input langsung seperti MVP 1.2B.</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <button className={mode === "pdf" ? "btn" : "btn secondary"} type="button" onClick={() => setMode("pdf")}>PDF + AI Extraction</button>
          <button className={mode === "manual" ? "btn" : "btn secondary"} type="button" onClick={() => setMode("manual")}>Manual Input</button>
        </div>
      </div>

      {mode === "pdf" ? (
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
