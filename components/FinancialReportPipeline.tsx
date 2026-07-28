"use client";

import { useEffect, useState } from "react";
import { PipelineStatusBadge } from "@/components/PipelineStatusBadge";

type PipelineRun = {
  id: string;
  fileName: string;
  status: string;
  year: number | null;
  periodType: string | null;
  updatedAt: string;
  company: { ticker: string; name: string };
  review: { pending: number; accepted: number; rejected: number; committed: number };
  _count: { chunks: number; candidates: number };
};

type SummaryCount = { reports: number; companies: number };
type PipelineSummary = {
  all: SummaryCount;
  needReview: SummaryCount;
  readyToCommit: SummaryCount;
  committed: SummaryCount;
  failed: SummaryCount;
};

type Props = { onOpen: (id: string) => void | Promise<void>; refreshKey?: string };
type FilterKey = "ALL" | "NEED_REVIEW" | "READY_TO_COMMIT" | "COMMITTED" | "FAILED";

const filterLabels: Record<FilterKey, string> = {
  ALL: "All",
  NEED_REVIEW: "Need Review",
  READY_TO_COMMIT: "Ready",
  COMMITTED: "Committed",
  FAILED: "Failed",
};

const cardPalette: Record<Exclude<FilterKey, "ALL">, { accent: string; background: string }> = {
  NEED_REVIEW: { accent: "#fbbf24", background: "rgba(245, 158, 11, 0.08)" },
  READY_TO_COMMIT: { accent: "#7dd3fc", background: "rgba(56, 189, 248, 0.08)" },
  COMMITTED: { accent: "#6ee7b7", background: "rgba(52, 211, 153, 0.08)" },
  FAILED: { accent: "#fca5a5", background: "rgba(248, 113, 113, 0.08)" },
};

function actionLabel(status: string) {
  if (status === "COMMITTED") return "View Review Audit";
  if (status === "READY_TO_COMMIT") return "Final Review";
  if (status === "FAILED") return "View Error";
  if (status === "PROCESSING" || status === "UPLOADED") return "View Progress";
  return "Continue Review";
}

function friendlyStatus(status: string) {
  if (status === "PENDING_REVIEW") return "NEED REVIEW";
  if (status === "READY_TO_COMMIT") return "READY TO COMMIT";
  return status.replaceAll("_", " ");
}

export function FinancialReportPipeline({ onOpen, refreshKey = "" }: Props) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "20", filter });
        if (search) params.set("search", search);
        const response = await fetch(`/api/pdf-extractions?${params.toString()}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Gagal membaca pipeline laporan.");
        if (cancelled) return;
        setRuns(data.runs ?? []); setSummary(data.summary ?? null); setTotalPages(data.pagination?.totalPages ?? 1);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Gagal membaca pipeline laporan.");
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [filter, page, search, refreshKey]);

  function chooseFilter(next: FilterKey) { setFilter(next); setPage(1); }
  function submitSearch(event: React.FormEvent) { event.preventDefault(); setSearch(searchInput.trim()); setPage(1); }

  const cards: Array<{ key: Exclude<FilterKey, "ALL">; label: string; count: SummaryCount | undefined }> = [
    { key: "NEED_REVIEW", label: "Need Review", count: summary?.needReview },
    { key: "READY_TO_COMMIT", label: "Ready to Commit", count: summary?.readyToCommit },
    { key: "COMMITTED", label: "Committed", count: summary?.committed },
    { key: "FAILED", label: "Failed", count: summary?.failed },
  ];

  return <section style={{ marginTop: 20 }}>
    <div className="section-title"><div><h3>Financial Report Pipeline</h3><p>Workspace & histori seluruh laporan: upload, review, ready-to-commit, sampai canonical database.</p></div>{summary && <span className="badge">{summary.all.companies} companies · {summary.all.reports} reports</span>}</div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
      {cards.map((card) => { const palette = cardPalette[card.key]; return <button key={card.key} type="button" className="card" onClick={() => chooseFilter(card.key)} style={{ textAlign: "left", cursor: "pointer", border: `1px solid ${filter === card.key ? palette.accent : "rgba(148, 163, 184, 0.22)"}`, borderLeft: `4px solid ${palette.accent}`, background: palette.background, minHeight: 112 }}><div style={{ color: palette.accent, fontWeight: 800 }}>{card.label}</div><div style={{ color: "#f8fafc", fontSize: 30, lineHeight: 1, fontWeight: 900, marginTop: 10 }}>{card.count?.reports ?? 0}</div><small style={{ color: "#cbd5e1", display: "block", marginTop: 8 }}>{card.count?.companies ?? 0} companies</small></button>; })}
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>{(Object.keys(filterLabels) as FilterKey[]).map((key) => <button key={key} type="button" className={filter === key ? "btn" : "btn secondary"} onClick={() => chooseFilter(key)}>{filterLabels[key]}</button>)}</div>

    <form onSubmit={submitSearch} style={{ display: "flex", gap: 8, marginTop: 12 }}><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Cari ticker, perusahaan, atau file..." style={{ flex: 1 }} /><button className="btn secondary" type="submit">Search</button></form>

    {error && <div className="callout" style={{ marginTop: 12 }}>{error}</div>}
    {loading && <p style={{ marginTop: 12 }}>Memuat pipeline...</p>}
    {!loading && runs.length === 0 && <div className="callout" style={{ marginTop: 12 }}>Belum ada laporan pada filter ini.</div>}

    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>{runs.map((run) => {
      const reviewed = run.review.accepted + run.review.rejected + run.review.committed;
      return <div className="card" key={run.id} style={{ padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}><div><strong style={{ color: "#f8fafc" }}>{run.company.ticker} — {run.company.name}</strong><div className="form-hint">{run.periodType ?? "?"} {run.year ?? "?"} · {run.fileName}</div></div><PipelineStatusBadge status={friendlyStatus(run.status)} compact /></div><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}><PipelineStatusBadge status={`COMMITTED ${run.review.committed}`} compact /><PipelineStatusBadge status={`REJECTED ${run.review.rejected}`} compact /><PipelineStatusBadge status={`PENDING ${run.review.pending}`} compact /></div><div className="form-hint" style={{ marginTop: 8 }}>{reviewed}/{run._count.candidates} reviewed · {run._count.chunks} chunks</div><div style={{ marginTop: 10 }}><button className="btn secondary" type="button" onClick={() => void onOpen(run.id)}>{actionLabel(run.status)}</button></div></div>;
    })}</div>

    {totalPages > 1 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}><button className="btn secondary" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span className="form-hint">Page {page} / {totalPages}</span><button className="btn secondary" type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button></div>}
  </section>;
}
