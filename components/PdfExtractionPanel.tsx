"use client";

import { FormEvent, useEffect, useState } from "react";

type Company = { id: string; ticker: string; name: string };
type Run = {
  id: string;
  fileName: string;
  status: string;
  year: number | null;
  periodType: string | null;
  createdAt: string;
  company: { ticker: string; name: string };
  _count: { chunks: number; candidates: number };
};

export function PdfExtractionPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [year, setYear] = useState("2025");
  const [periodType, setPeriodType] = useState("FY");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function refreshRuns() {
    const response = await fetch("/api/pdf-extractions", { cache: "no-store" });
    const data = await response.json();
    if (response.ok && data.ok) setRuns(data.runs);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/companies", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/pdf-extractions", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([companyData, runData]) => {
      if (companyData.ok) {
        setCompanies(companyData.companies);
        if (companyData.companies[0]) setCompanyId(companyData.companies[0].id);
      }
      if (runData.ok) setRuns(runData.runs);
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !companyId) return;
    setLoading(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("companyId", companyId);
      form.set("year", year);
      form.set("periodType", periodType);
      const response = await fetch("/api/pdf-extractions", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Upload gagal.");
      setMessage(data.message);
      await refreshRuns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload gagal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="header">
        <div>
          <h2>PDF + AI Extraction — MVP 1.2D</h2>
          <p className="form-hint">PDF masuk ke staging terlebih dahulu. AI tidak menulis langsung ke canonical database.</p>
        </div>
        <span className="badge warning">STAGING ONLY</span>
      </div>

      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label>Company</label>
            <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required>
              {companies.map((company) => <option value={company.id} key={company.id}>{company.ticker} — {company.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Period</label>
            <select value={periodType} onChange={(event) => setPeriodType(event.target.value)}>
              <option value="FY">FY</option><option value="Q1">Q1</option><option value="H1">H1</option><option value="Q3">Q3</option>
            </select>
          </div>
          <div className="field">
            <label>Year</label>
            <input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} required />
          </div>
          <div className="field">
            <label>Financial Statement PDF</label>
            <input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
          </div>
        </div>
        <div style={{ height: 14 }} />
        <button className="btn" type="submit" disabled={loading || !file || !companyId}>{loading ? "Registering PDF..." : "Upload to Staging"}</button>
        {message && <div className="form-message success-message">{message}</div>}
      </form>

      <div style={{ height: 18 }} />
      <h3>Recent extraction runs</h3>
      {runs.length === 0 ? <p className="form-hint">Belum ada PDF di staging.</p> : (
        <div style={{ display: "grid", gap: 10 }}>
          {runs.map((run) => (
            <div className="callout" key={run.id}>
              <b>{run.company.ticker}</b> · {run.fileName}<br />
              <span>{run.periodType ?? "?"} {run.year ?? "?"} · {run.status} · {run._count.chunks} chunks · {run._count.candidates} candidates</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
