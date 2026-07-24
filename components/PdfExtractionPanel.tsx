"use client";

import { FormEvent, useEffect, useState } from "react";

type Company = { id: string; ticker: string; name: string };
type Run = { id: string; fileName: string; status: string; year: number | null; periodType: string | null; createdAt: string; company: { ticker: string; name: string }; _count: { chunks: number; candidates: number } };
type Account = { id: string; code: string; name: string; statementType: string };
type Candidate = { id: string; statementType: string | null; reportedLabel: string; rawValue: string; numericValue: string | number | null; currency: string | null; scale: number; sourcePage: number | null; sourceText: string | null; extractionConfidence: number | null; mappingConfidence: number | null; status: string; canonicalAccountId: string | null; canonicalAccount: Account | null };
type RunDetail = Run & { candidates: Candidate[]; chunks: unknown[]; pageCount: number | null; currency: string | null; unitScale: number | null };

function pct(value: number | null) { return value == null ? "—" : `${Math.round(value * 100)}%`; }

export function PdfExtractionPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [year, setYear] = useState("2025");
  const [periodType, setPeriodType] = useState("FY");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busyCandidate, setBusyCandidate] = useState("");

  async function refreshRuns() {
    const response = await fetch("/api/pdf-extractions", { cache: "no-store" });
    const data = await response.json();
    if (response.ok && data.ok) setRuns(data.runs);
  }

  async function openRun(id: string) {
    setMessage("");
    const response = await fetch(`/api/pdf-extractions/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "Gagal membuka hasil extraction.");
    setSelected(data.run);
    setAccounts(data.accounts);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/companies", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/pdf-extractions", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([companyData, runData]) => {
      if (companyData.ok) { setCompanies(companyData.companies); if (companyData.companies[0]) setCompanyId(companyData.companies[0].id); }
      if (runData.ok) setRuns(runData.runs);
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !companyId) return;
    setLoading(true); setMessage(""); setSelected(null);
    try {
      const form = new FormData();
      form.set("file", file); form.set("companyId", companyId); form.set("year", year); form.set("periodType", periodType);
      const response = await fetch("/api/pdf-extractions", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Upload gagal.");
      setMessage(data.message); await refreshRuns();
      if (data.runId) await openRun(data.runId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload gagal."); }
    finally { setLoading(false); }
  }

  async function review(candidate: Candidate, decision: "ACCEPTED" | "REJECTED", canonicalAccountId?: string | null) {
    if (!selected) return;
    setBusyCandidate(candidate.id); setMessage("");
    try {
      const response = await fetch(`/api/pdf-extractions/${selected.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: candidate.id, decision, canonicalAccountId: canonicalAccountId ?? candidate.canonicalAccountId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Review gagal.");
      await openRun(selected.id); await refreshRuns();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Review gagal."); }
    finally { setBusyCandidate(""); }
  }

  async function commitRun() {
    if (!selected || !confirm("Commit semua candidate ACCEPTED ke canonical PostgreSQL? Data existing untuk periode yang sama tidak akan ditimpa.")) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/pdf-extractions/${selected.id}/commit`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Commit gagal.");
      setMessage(data.message); await openRun(selected.id); await refreshRuns();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Commit gagal."); }
    finally { setLoading(false); }
  }

  const pending = selected?.candidates.filter((c) => c.status === "PENDING").length ?? 0;
  const accepted = selected?.candidates.filter((c) => c.status === "ACCEPTED").length ?? 0;

  return <>
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="header"><div><h2>PDF + AI Extraction — MVP 1.2D</h2><p>Upload LK PDF → AI membaca seluruh dokumen → review kandidat → baru commit ke canonical PostgreSQL.</p></div><span className="badge warning">HUMAN REVIEW GATE</span></div>
      <form onSubmit={submit}><div className="form-grid">
        <div className="field"><label>Company</label><select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>{companies.map((c) => <option value={c.id} key={c.id}>{c.ticker} — {c.name}</option>)}</select></div>
        <div className="field"><label>Period</label><select value={periodType} onChange={(e) => setPeriodType(e.target.value)}><option>FY</option><option>Q1</option><option>H1</option><option>Q3</option></select></div>
        <div className="field"><label>Year</label><input type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(e.target.value)} required /></div>
        <div className="field"><label>Financial Statement PDF</label><input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></div>
      </div><div style={{ height: 14 }} /><button className="btn" type="submit" disabled={loading || !file || !companyId}>{loading ? "AI is reading PDF..." : "Upload & Extract PDF"}</button></form>
      {message && <div className="callout" style={{ marginTop: 14 }}>{message}</div>}
      <div style={{ height: 18 }} /><h3>Recent extraction runs</h3>
      {runs.length === 0 ? <p>Belum ada PDF di staging.</p> : <div style={{ display: "grid", gap: 10 }}>{runs.map((run) => <button type="button" className="account-master-row" key={run.id} onClick={() => openRun(run.id)}><div><strong>{run.company.ticker} · {run.fileName}</strong><small>{run.periodType ?? "?"} {run.year ?? "?"} · {run._count.chunks} chunks · {run._count.candidates} candidates</small></div><span className="badge">{run.status}</span></button>)}</div>}
    </section>

    {selected && <section className="card">
      <div className="section-title"><div><h2>Review Extraction — {selected.company.ticker}</h2><p>{selected.fileName} · {selected.periodType} {selected.year} · {selected.pageCount ?? "?"} pages</p></div><div><span className="badge">Pending {pending}</span> <span className="badge">Accepted {accepted}</span></div></div>
      <div className="callout"><b>Golden Rule:</b> AI hanya mengusulkan. Hanya candidate ACCEPTED yang dapat masuk canonical database, dan commit diblokir bila periode yang sama sudah ada.</div>
      <div className="extraction-list">
        {selected.candidates.map((candidate) => <div className="extraction-candidate" key={candidate.id}>
          <div className="extraction-main"><strong>{candidate.reportedLabel}</strong><span className="metric-value">{candidate.rawValue}</span><small>Page {candidate.sourcePage ?? "?"} · Read {pct(candidate.extractionConfidence)} · Map {pct(candidate.mappingConfidence)}</small>{candidate.sourceText && <small className="evidence">Evidence: {candidate.sourceText}</small>}</div>
          <div className="extraction-actions"><select value={candidate.canonicalAccountId ?? ""} onChange={(e) => review(candidate, "ACCEPTED", e.target.value || null)} disabled={busyCandidate === candidate.id}><option value="">— Select canonical account —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select><div><button className="btn" type="button" disabled={!candidate.canonicalAccountId || busyCandidate === candidate.id} onClick={() => review(candidate, "ACCEPTED")}>Accept</button> <button className="btn secondary" type="button" disabled={busyCandidate === candidate.id} onClick={() => review(candidate, "REJECTED")}>Reject</button></div><span className={`badge ${candidate.status === "PENDING" ? "warning" : ""}`}>{candidate.status}</span></div>
        </div>)}
      </div>
      <div style={{ height: 16 }} /><button className="btn" type="button" onClick={commitRun} disabled={loading || pending > 0 || accepted === 0 || selected.status === "COMMITTED"}>{selected.status === "COMMITTED" ? "Committed to PostgreSQL ✓" : pending > 0 ? `Review ${pending} remaining candidates` : "Commit Reviewed Data to PostgreSQL"}</button>
    </section>}
  </>;
}
