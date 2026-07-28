"use client";

import { useEffect, useState } from "react";

type Diagnostic = {
  ok: boolean;
  checkedAt: string;
  report: {
    id: string;
    ticker: string;
    companyName: string;
    year: number;
    periodType: string;
    periodEnd: string;
    status: string;
    sourceFile: string | null;
  };
  canonicalEntries: Array<{
    id: string;
    code: string;
    accountName: string;
    value: string;
    scale: number;
    currency: string;
    reportedLabel: string | null;
    rawText: string | null;
    sourcePage: number | null;
    isVerified: boolean;
    confidence: number | null;
    createdAt: string;
  }>;
  stagingCandidates: Array<{
    runId: string;
    runStatus: string;
    candidateId: string;
    code: string | null;
    reportedLabel: string;
    rawValue: string;
    numericValue: string | null;
    scale: number;
    status: string;
    sourcePage: number | null;
    reviewNote: string | null;
  }>;
  conclusion: { arInCanonical: boolean; apInCanonical: boolean };
};

export default function ArApDiagnosticPage() {
  const [data, setData] = useState<Diagnostic | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/diagnostics/canonical-ar-ap?ticker=ICBP&year=2025&periodType=H1", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Diagnostic gagal.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagnostic gagal.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
    <div className="section-title">
      <div>
        <h1>ICBP H1 2025 — AR/AP Database Check</h1>
        <p>Read-only diagnostic langsung dari PostgreSQL Railway melalui Prisma.</p>
      </div>
      <button className="btn secondary" type="button" onClick={load} disabled={loading}>{loading ? "Checking..." : "Refresh"}</button>
    </div>

    {error && <div className="callout">{error}</div>}
    {data && <>
      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Conclusion</h2>
        <p><b>AR in canonical:</b> {data.conclusion.arInCanonical ? "YES ❌" : "NO ✅"}</p>
        <p><b>AP in canonical:</b> {data.conclusion.apInCanonical ? "YES ❌" : "NO ✅"}</p>
        <p><b>Report:</b> {data.report.ticker} · {data.report.periodType} {data.report.year} · {data.report.status}</p>
        <p><b>Checked:</b> {new Date(data.checkedAt).toLocaleString()}</p>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Canonical FinancialEntry rows</h2>
        {data.canonicalEntries.length === 0 ? <div className="callout">Tidak ada AR/AP di canonical FinancialEntry.</div> : <div style={{ display: "grid", gap: 12 }}>
          {data.canonicalEntries.map((entry) => <div className="card" key={entry.id}>
            <h3>{entry.code} — {entry.accountName}</h3>
            <p><b>Value:</b> {entry.value} × scale {entry.scale} {entry.currency}</p>
            <p><b>Reported label:</b> {entry.reportedLabel || "—"}</p>
            <p><b>Source page:</b> {entry.sourcePage ?? "—"}</p>
            <p><b>Raw provenance:</b> {entry.rawText || "—"}</p>
          </div>)}
        </div>}
      </section>

      <section className="card">
        <h2>ExtractionCandidate audit rows</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {data.stagingCandidates.map((candidate) => <div className="card" key={candidate.candidateId}>
            <p><b>{candidate.code || "UNMAPPED"}</b> · {candidate.status}</p>
            <p>{candidate.reportedLabel}</p>
            <p><b>Raw value:</b> {candidate.rawValue} · <b>Page:</b> {candidate.sourcePage ?? "—"}</p>
            <p><b>Review note:</b> {candidate.reviewNote || "—"}</p>
          </div>)}
        </div>
      </section>
    </>}
  </main>;
}
