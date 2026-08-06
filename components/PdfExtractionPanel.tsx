"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FinancialReportPipeline } from "@/components/FinancialReportPipeline";
import { PipelineStatusBadge } from "@/components/PipelineStatusBadge";
import { withNetworkRetry } from "@/lib/network-retry";

type Run = { id: string; fileName: string; status: string; year: number | null; periodType: string | null; createdAt: string; company: { ticker: string; name: string }; _count: { chunks: number; candidates: number } };
type Account = { id: string; code: string; name: string; statementType: string };
type Candidate = { id: string; statementType: string | null; reportedLabel: string; rawValue: string; numericValue: string | number | null; currency: string | null; scale: number; sourcePage: number | null; sourceText: string | null; extractionConfidence: number | null; mappingConfidence: number | null; status: string; canonicalAccountId: string | null; canonicalAccount: Account | null; candidateRole: string; componentOf: string | null; qualityStatus: string; qualityReasons: unknown; reviewedBy: string | null };
type QualitySummary = { verifiedFacts: number; evidenceOnly: number; exceptions: number; verifiedCodes: string[]; missingCodes: string[] };
type RunDetail = Run & { candidates: Candidate[]; chunks: unknown[]; pageCount: number | null; currency: string | null; unitScale: number | null; qualitySummary?: QualitySummary };
type GroupKey = "BALANCE_SHEET" | "INCOME_STATEMENT" | "CASH_FLOW" | "OTHER";
type MetadataGate = { code: "COMPANY_CONFIRMATION_REQUIRED" | "COMPANY_NOT_FOUND" | "PERIOD_CONFIRMATION_REQUIRED"; message: string; detectedCompany?: { ticker: string | null; name: string | null; confidence: number }; suggestedCompany?: { id: string; ticker: string; name: string } | null; detectedPeriod?: { periodType: string | null; year: number | null; confidence: number }; detectedCurrency?: string | null };
type CompanyDraft = { ticker: string; name: string; sector: string; subsector: string; country: string; currency: string; fiscalYearEnd: string };

function pct(value: number | null | undefined) { return value == null ? "—" : `${Math.round(value * 100)}%`; }

const groupMeta: Record<GroupKey, { label: string; description: string }> = {
  BALANCE_SHEET: { label: "Neraca", description: "Aset, liabilitas, dan ekuitas" },
  INCOME_STATEMENT: { label: "Laba Rugi", description: "Pendapatan, beban, dan laba" },
  CASH_FLOW: { label: "Arus Kas", description: "Operasi, investasi, dan pendanaan" },
  OTHER: { label: "Lainnya / Perlu Review", description: "Kandidat yang belum terklasifikasi ke 3 laporan utama" },
};

export function PdfExtractionPanel() {
  const [pipelineRefreshKey, setPipelineRefreshKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadAttempt, setUploadAttempt] = useState(0);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busyCandidate, setBusyCandidate] = useState("");
  const [metadataGate, setMetadataGate] = useState<MetadataGate | null>(null);
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft>({ ticker: "", name: "", sector: "", subsector: "", country: "ID", currency: "IDR", fiscalYearEnd: "12" });
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({ BALANCE_SHEET: false, INCOME_STATEMENT: false, CASH_FLOW: false, OTHER: false });
  const [showReviewed, setShowReviewed] = useState<Record<GroupKey, boolean>>({ BALANCE_SHEET: false, INCOME_STATEMENT: false, CASH_FLOW: false, OTHER: false });

  function refreshPipeline() { setPipelineRefreshKey(`${Date.now()}`); }

  async function openRun(id: string, resetPanels = true) {
    setMessage("");
    const response = await fetch(`/api/pdf-extractions/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "Gagal membuka hasil extraction.");
    setSelected({ ...data.run, qualitySummary: data.qualitySummary }); setAccounts(data.accounts); setMetadataGate(null);
    if (resetPanels) {
      setOpenGroups({ BALANCE_SHEET: false, INCOME_STATEMENT: false, CASH_FLOW: false, OTHER: false });
      setShowReviewed({ BALANCE_SHEET: false, INCOME_STATEMENT: false, CASH_FLOW: false, OTHER: false });
    }
    setTimeout(() => document.getElementById("report-review-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  useEffect(() => { refreshPipeline(); }, []);

  async function uploadFile(confirmedCompanyId?: string) {
    if (!file) return;
    setLoading(true); setMessage(""); setSelected(null);
    try {
      const uploadId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const response = await withNetworkRetry(async (attempt) => {
        setUploadAttempt(attempt);
        const form = new FormData();
        form.set("file", file);
        if (confirmedCompanyId) form.set("confirmedCompanyId", confirmedCompanyId);
        const result = await fetch("/api/pdf-extractions", {
          method: "POST",
          body: form,
          headers: { "X-InvestAI-Upload-ID": uploadId },
        });
        if (result.status === 502 || result.status === 504) {
          throw new TypeError(`Temporary Railway gateway failure (${result.status})`);
        }
        return result;
      }, {
        attempts: 3,
        baseDelayMs: 1_500,
        onRetry: (attempt) => setMessage(`Koneksi upload terputus. Mencoba ulang otomatis (${attempt}/3)…`),
      });
      const responseText = await response.text();
      const data = responseText ? JSON.parse(responseText) : {};
      if (!response.ok) {
        if (response.status === 422 && data.code) {
          const gate = data as MetadataGate; setMetadataGate(gate);
          setCompanyDraft({ ticker: gate.detectedCompany?.ticker ?? "", name: gate.detectedCompany?.name ?? "", sector: "", subsector: "", country: "ID", currency: gate.detectedCurrency || "IDR", fiscalYearEnd: "12" });
          setMessage(gate.message); return;
        }
        throw new Error(data.error ?? data.message ?? "Upload gagal.");
      }
      setMetadataGate(null); setMessage(data.message); refreshPipeline(); if (data.runId) await openRun(data.runId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload gagal."); }
    finally { setLoading(false); setUploadAttempt(0); }
  }

  async function submit(event: FormEvent) { event.preventDefault(); await uploadFile(); }

  async function addCompanyAndRetry() {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...companyDraft, fiscalYearEnd: Number(companyDraft.fiscalYearEnd) }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Gagal menambahkan emiten ke Company Master.");
      setMessage(`${data.company.ticker} ditambahkan ke Company Master. AI melanjutkan extraction...`); setMetadataGate(null); await uploadFile(data.company.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Gagal menambahkan emiten."); setLoading(false); }
  }

  async function review(candidate: Candidate, decision: "PENDING" | "ACCEPTED" | "REJECTED", canonicalAccountId?: string | null) {
    if (!selected || selected.status === "COMMITTED") return;
    setBusyCandidate(candidate.id); setMessage("");
    try {
      const targetAccountId = canonicalAccountId === undefined ? candidate.canonicalAccountId : canonicalAccountId;
      const response = await fetch(`/api/pdf-extractions/${selected.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: candidate.id, decision, canonicalAccountId: targetAccountId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Review gagal.");
      const mappedAccount = targetAccountId ? accounts.find((account) => account.id === targetAccountId) ?? candidate.canonicalAccount : candidate.canonicalAccount;
      setSelected((current) => current ? { ...current, status: data.pending === 0 ? "READY_TO_COMMIT" : "PENDING_REVIEW", candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, status: decision, canonicalAccountId: targetAccountId ?? null, canonicalAccount: mappedAccount ?? null } : item) } : current);
      refreshPipeline();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Review gagal."); }
    finally { setBusyCandidate(""); }
  }

  const pending = selected?.candidates.filter((c) => c.status === "PENDING").length ?? 0;
  const accepted = selected?.candidates.filter((c) => c.status === "ACCEPTED").length ?? 0;
  const rejected = selected?.candidates.filter((c) => c.status === "REJECTED").length ?? 0;
  const committedCandidates = selected?.candidates.filter((c) => c.status === "COMMITTED").length ?? 0;
  const committed = selected?.status === "COMMITTED";
  const quality = selected?.qualitySummary;

  async function commitRun() {
    if (!selected || committed) return;
    if (!confirm(`SAVE VERIFIED CANONICALS ${selected.company.ticker} ${selected.periodType} ${selected.year}?\n\nGREEN facts: ${accepted}\nEvidence-only: ${rejected}\nExceptions: ${pending}\n\nHanya canonical GREEN yang masuk PostgreSQL. Setelah disimpan, data dikunci dan koreksi harus melalui revision flow.`)) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/pdf-extractions/${selected.id}/commit`, { method: "POST" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Commit gagal.");
      setMessage(data.message); await openRun(selected.id, false); refreshPipeline();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Commit gagal."); }
    finally { setLoading(false); }
  }

  const grouped = useMemo(() => {
    const result: Record<GroupKey, Candidate[]> = { BALANCE_SHEET: [], INCOME_STATEMENT: [], CASH_FLOW: [], OTHER: [] };
    for (const candidate of selected?.candidates ?? []) {
      const key: GroupKey = candidate.statementType === "BALANCE_SHEET" || candidate.statementType === "INCOME_STATEMENT" || candidate.statementType === "CASH_FLOW" ? candidate.statementType : "OTHER";
      result[key].push(candidate);
    }
    return result;
  }, [selected]);

  function renderCandidate(candidate: Candidate, reviewed = false) {
    const candidateCommitted = candidate.status === "COMMITTED";
    const candidateRejected = candidate.status === "REJECTED";
    const controlsLocked = committed || candidateCommitted;
    return <div className="extraction-candidate" key={candidate.id} style={reviewed || controlsLocked ? { opacity: 0.78 } : undefined}>
      <div className="extraction-main"><strong>{candidate.reportedLabel}</strong><span className="metric-value">{candidate.rawValue}</span><small>Page {candidate.sourcePage ?? "?"} · Read {pct(candidate.extractionConfidence)} · Map {pct(candidate.mappingConfidence)} · {candidate.candidateRole} · QC {candidate.qualityStatus}</small>{candidate.componentOf && <small>Evidence component of {candidate.componentOf}</small>}{candidate.sourceText && <small className="evidence">Evidence: {candidate.sourceText}</small>}</div>
      <div className="extraction-actions">
        <select value={candidate.canonicalAccountId ?? ""} onChange={(e) => review(candidate, "ACCEPTED", e.target.value || null)} disabled={busyCandidate === candidate.id || reviewed || controlsLocked}><option value="">— Select canonical account —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
        {candidateCommitted ? <PipelineStatusBadge status="COMMITTED TO CANONICAL 🔒" compact /> : candidateRejected && committed ? <PipelineStatusBadge status="EVIDENCE — NOT COMMITTED" compact /> : reviewed ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><PipelineStatusBadge status={candidate.status === "ACCEPTED" ? "GREEN ✓" : "EVIDENCE ONLY"} compact />{candidate.reviewedBy !== "canonical-quality-engine" && <button className="btn secondary" type="button" disabled={busyCandidate === candidate.id} onClick={() => review(candidate, "PENDING")}>Make Pending</button>}</div> : <div><button className="btn" type="button" disabled={!candidate.canonicalAccountId || busyCandidate === candidate.id} onClick={() => review(candidate, "ACCEPTED")}>Accept Exception</button>{" "}<button className="btn secondary" type="button" disabled={busyCandidate === candidate.id} onClick={() => review(candidate, "REJECTED")}>Reject Exception</button></div>}
      </div>
    </div>;
  }

  return <>
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="header"><div><h2>PDF + AI Extraction — MVP 1.2D</h2><p>Upload laporan baru di sini. Pekerjaan lama tetap tersimpan di Financial Report Pipeline di bawah.</p></div><span className="badge success">AUTO QC + EXCEPTION REVIEW</span></div>
      <form onSubmit={submit}><div className="field"><label>Financial Statement PDF</label><input type="file" accept="application/pdf,.pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMetadataGate(null); setMessage(""); }} required /></div><div style={{ height: 14 }} /><button className="btn" type="submit" disabled={loading || !file}>{loading ? `Uploading PDF${uploadAttempt > 1 ? ` — retry ${uploadAttempt}/3` : ""}…` : "Upload & Extract PDF"}</button></form>
      {message && <div className="callout" style={{ marginTop: 14 }}>{message}</div>}
      {metadataGate && <div className="card" style={{ marginTop: 16 }}><h3>Review Metadata AI</h3><p><b>Detected issuer:</b> {metadataGate.detectedCompany?.ticker || "?"} — {metadataGate.detectedCompany?.name || "?"} · confidence {pct(metadataGate.detectedCompany?.confidence)}</p><p><b>Detected period:</b> {metadataGate.detectedPeriod?.periodType || "?"} {metadataGate.detectedPeriod?.year || "?"} · confidence {pct(metadataGate.detectedPeriod?.confidence)}</p>{metadataGate.code === "COMPANY_CONFIRMATION_REQUIRED" && metadataGate.suggestedCompany && <><p>Company Master terdekat: <b>{metadataGate.suggestedCompany.ticker} — {metadataGate.suggestedCompany.name}</b></p><button className="btn" type="button" disabled={loading} onClick={() => uploadFile(metadataGate.suggestedCompany!.id)}>Confirm Company & Continue</button></>}{metadataGate.code === "COMPANY_NOT_FOUND" && <div style={{ display: "grid", gap: 10 }}><div className="callout"><b>Emiten belum ada di Company Master.</b> AI hanya membuat draft. Periksa terutama ticker sebelum menambahkan.</div><div className="form-grid"><div className="field"><label>Ticker</label><input value={companyDraft.ticker} onChange={(e) => setCompanyDraft((v) => ({ ...v, ticker: e.target.value.toUpperCase() }))} /></div><div className="field"><label>Legal Company Name</label><input value={companyDraft.name} onChange={(e) => setCompanyDraft((v) => ({ ...v, name: e.target.value }))} /></div><div className="field"><label>Sector</label><input value={companyDraft.sector} onChange={(e) => setCompanyDraft((v) => ({ ...v, sector: e.target.value }))} /></div><div className="field"><label>Subsector</label><input value={companyDraft.subsector} onChange={(e) => setCompanyDraft((v) => ({ ...v, subsector: e.target.value }))} /></div><div className="field"><label>Country</label><input value={companyDraft.country} maxLength={2} onChange={(e) => setCompanyDraft((v) => ({ ...v, country: e.target.value.toUpperCase() }))} /></div><div className="field"><label>Currency</label><input value={companyDraft.currency} maxLength={3} onChange={(e) => setCompanyDraft((v) => ({ ...v, currency: e.target.value.toUpperCase() }))} /></div><div className="field"><label>Fiscal Year End Month</label><input type="number" min="1" max="12" value={companyDraft.fiscalYearEnd} onChange={(e) => setCompanyDraft((v) => ({ ...v, fiscalYearEnd: e.target.value }))} /></div></div><button className="btn" type="button" disabled={loading || !companyDraft.ticker || !companyDraft.name} onClick={addCompanyAndRetry}>Confirm & Add Company, Then Continue</button></div>}{metadataGate.code === "PERIOD_CONFIRMATION_REQUIRED" && <div className="callout">Periode belum cukup yakin untuk dilanjutkan. Jangan commit sampai periode dikenali jelas.</div>}</div>}
      <FinancialReportPipeline onOpen={(id) => openRun(id)} refreshKey={pipelineRefreshKey} />
    </section>

    {selected && <section className="card" id="report-review-workspace">
      <div className="section-title"><div><h2>{selected.company.ticker} — {selected.company.name}</h2><p>{selected.periodType} {selected.year} · {selected.fileName} · {selected.pageCount ?? "?"} pages</p></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><PipelineStatusBadge status={`EXCEPTIONS ${pending}`} compact /><PipelineStatusBadge status={`GREEN ${accepted}`} compact /><PipelineStatusBadge status={`EVIDENCE ${rejected}`} compact />{committed && <PipelineStatusBadge status={`COMMITTED ${committedCandidates}`} compact />}</div></div>
      <div className="callout">{committed ? <><b>FINAL COMMIT selesai 🔒</b> Hanya kandidat GREEN yang masuk canonical PostgreSQL. Evidence-only tetap tersimpan sebagai audit.</> : <><b>Canonical quality engine:</b> GREEN otomatis siap disimpan; komponen dan duplikat menjadi evidence-only; hanya exception YELLOW/RED yang memerlukan review.</>}</div>
      {quality && <div className="card" style={{ marginTop: 14 }}><h3>Canonical QC Summary</h3><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}><PipelineStatusBadge status={`GREEN FACTS ${quality.verifiedFacts}`} /><PipelineStatusBadge status={`EVIDENCE ONLY ${quality.evidenceOnly}`} /><PipelineStatusBadge status={`EXCEPTIONS ${quality.exceptions}`} /></div><p className="form-hint" style={{ marginTop: 10 }}>Verified: {quality.verifiedCodes.join(", ") || "—"}</p>{quality.missingCodes.length > 0 && <p className="form-hint">Not safely reported (not invented): {quality.missingCodes.join(", ")}</p>}</div>}
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>{(["BALANCE_SHEET", "INCOME_STATEMENT", "CASH_FLOW", "OTHER"] as GroupKey[]).map((key) => {
        const items = grouped[key]; if (items.length === 0) return null;
        const pendingItems = items.filter((item) => item.status === "PENDING");
        const acceptedItems = items.filter((item) => item.status === "ACCEPTED");
        const rejectedItems = items.filter((item) => item.status === "REJECTED");
        const committedItems = items.filter((item) => item.status === "COMMITTED");
        const reviewedItems = items.filter((item) => item.status !== "PENDING");
        return <div className="card" key={key} style={{ padding: 0, overflow: "hidden" }}><button type="button" onClick={() => setOpenGroups((current) => ({ ...current, [key]: !current[key] }))} style={{ width: "100%", background: "transparent", border: 0, color: "inherit", textAlign: "left", padding: 16, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><div><strong style={{ fontSize: 18, color: "#f8fafc" }}>{groupMeta[key].label}</strong><div className="form-hint" style={{ marginTop: 2 }}>{groupMeta[key].description}</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>{committed ? <PipelineStatusBadge status={`COMMITTED ${committedItems.length}`} compact /> : <PipelineStatusBadge status={`GREEN ${acceptedItems.length}`} compact />}<PipelineStatusBadge status={`EVIDENCE ${rejectedItems.length}`} compact /><PipelineStatusBadge status={`EXCEPTIONS ${pendingItems.length}`} compact /></div></div><span style={{ fontSize: 24, color: "#f8fafc" }}>{openGroups[key] ? "−" : "+"}</span></button>{openGroups[key] && <div className="extraction-list" style={{ padding: 16, paddingTop: 0 }}>{pendingItems.length ? pendingItems.map((candidate) => renderCandidate(candidate)) : <div className="callout">Tidak ada quality exception di bagian ini ✓</div>}{reviewedItems.length > 0 && <><div style={{ height: 10 }} /><button className="btn secondary" type="button" onClick={() => setShowReviewed((current) => ({ ...current, [key]: !current[key] }))}>{showReviewed[key] ? "Hide classified" : `Show classified (${reviewedItems.length})`}</button>{showReviewed[key] && <div style={{ display: "grid", gap: 10, marginTop: 12 }}>{reviewedItems.map((candidate) => renderCandidate(candidate, true))}</div>}</>}</div>}</div>;
      })}</div>
      <div className="card" style={{ marginTop: 16 }}><h3>Review Summary</h3><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>{committed ? <PipelineStatusBadge status={`COMMITTED ${committedCandidates}`} /> : <PipelineStatusBadge status={`GREEN ${accepted}`} />}<PipelineStatusBadge status={`EVIDENCE ${rejected}`} /><PipelineStatusBadge status={`EXCEPTIONS ${pending}`} /></div>{!committed && pending > 0 && <div className="callout" style={{ marginTop: 12 }}>Save dikunci karena masih ada exception quality yang harus diselesaikan.</div>}{!committed && pending === 0 && <div className="callout" style={{ marginTop: 12 }}><b>QC PASSED.</b> Bro cukup tekan Save; hanya canonical GREEN yang masuk PostgreSQL.</div>}{committed && <div className="callout" style={{ marginTop: 12 }}><b>DATABASE RESULT:</b> {committedCandidates} canonical facts masuk PostgreSQL; {rejected} evidence-only tidak dimasukkan.</div>}<div style={{ height: 12 }} /><button className="btn" type="button" onClick={commitRun} disabled={loading || pending > 0 || accepted === 0 || committed}>{committed ? "SAVED TO POSTGRESQL 🔒" : pending > 0 ? `SAVE locked — ${pending} exceptions` : "SAVE VERIFIED CANONICALS TO POSTGRESQL"}</button></div>
    </section>}
  </>;
}
