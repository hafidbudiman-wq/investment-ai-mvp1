"use client";

import { useState } from "react";

type PreviewRow = {
  reportedAccount: string;
  value: number;
  sheetName: string;
  rowNumber: number;
  mapped: boolean;
  canonicalCode: string | null;
  canonicalName: string | null;
};

type Preview = {
  fileName: string;
  rows: PreviewRow[];
  summary: { extracted: number; mapped: number; unmapped: number };
  message: string;
};

export function ExcelImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    if (!file) return;
    setLoading(true);
    setError("");
    setPreview(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/excel-import", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Import gagal");
      setPreview(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import gagal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="excel-import-panel">
      <div className="upload-zone">
        <strong>Upload Excel Financial Statement</strong>
        <p className="muted">MVP 1.2C membaca .xlsx/.xls, mengekstrak Account + Value, lalu mencocokkan ke Account Mapping. Maksimum 8 MB.</p>
        <input type="file" accept=".xlsx,.xls" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError(""); }} />
        <button className="btn" type="button" disabled={!file || loading} onClick={analyze}>{loading ? "Reading Excel..." : "Preview Excel"}</button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {preview && (
        <div className="excel-preview">
          <div className="callout"><b>{preview.fileName}</b> — {preview.message}</div>
          <div className="stats-grid compact">
            <div className="stat-card"><span>Extracted</span><b>{preview.summary.extracted}</b></div>
            <div className="stat-card"><span>Mapped</span><b>{preview.summary.mapped}</b></div>
            <div className="stat-card"><span>Need Mapping</span><b>{preview.summary.unmapped}</b></div>
          </div>
          <div className="responsive-table">
            <table>
              <thead><tr><th>Reported Account</th><th>Value</th><th>Canonical</th><th>Source</th></tr></thead>
              <tbody>{preview.rows.slice(0, 100).map((row) => (
                <tr key={`${row.sheetName}-${row.rowNumber}`}>
                  <td>{row.reportedAccount}</td><td>{row.value.toLocaleString()}</td>
                  <td>{row.mapped ? `${row.canonicalCode} — ${row.canonicalName}` : "Need Mapping"}</td>
                  <td>{row.sheetName} · row {row.rowNumber}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {preview.rows.length > 100 && <p className="muted">Preview menampilkan 100 baris pertama dari {preview.rows.length} baris.</p>}
          <button className="btn secondary" type="button" disabled title="Save diaktifkan setelah review workflow 1.2C tervalidasi.">Save to PostgreSQL — Review First</button>
        </div>
      )}
    </div>
  );
}
