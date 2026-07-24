"use client";

import { useMemo, useState } from "react";

export type CanonicalAccountItem = {
  id: string; code: string; name: string; displayNameId: string | null; description: string | null; definition: string | null; investorMeaning: string | null;
  aliases: unknown; relatedMetrics: unknown; positiveSignals: unknown; redFlags: unknown; sectorNotes: unknown; sourceRefs: unknown;
  statementType: "INCOME_STATEMENT" | "BALANCE_SHEET" | "CASH_FLOW" | "OTHER"; valueNature: "FLOW" | "STOCK" | "PER_SHARE" | "RATIO" | "TEXT";
  normalBalance: string | null; isCalculated: boolean; formula: string | null;
};

const statementLabel: Record<CanonicalAccountItem["statementType"], string> = { INCOME_STATEMENT: "Income Statement", BALANCE_SHEET: "Balance Sheet", CASH_FLOW: "Cash Flow", OTHER: "Other" };
const arr = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
type Source = { label?: string; url?: string };
const sources = (value: unknown): Source[] => Array.isArray(value) ? value.filter((v): v is Source => typeof v === "object" && v !== null) : [];

export function CanonicalAccountManager({ initialAccounts }: { initialAccounts: CanonicalAccountItem[] }) {
  const [accounts, setAccounts] = useState(initialAccounts); const [query, setQuery] = useState(""); const [selected, setSelected] = useState<CanonicalAccountItem | null>(null);
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [form, setForm] = useState({ code: "", name: "", description: "", statementType: "INCOME_STATEMENT", valueNature: "FLOW", normalBalance: "" });
  const visible = useMemo(() => { const q = query.toLowerCase().trim(); if (!q) return accounts; return accounts.filter((a) => `${a.code} ${a.name} ${a.displayNameId ?? ""} ${a.description ?? ""} ${a.definition ?? ""} ${arr(a.aliases).join(" ")}`.toLowerCase().includes(q)); }, [accounts, query]);

  async function save() { if (!form.code.trim() || !form.name.trim()) return; setSaving(true); setError(""); const response = await fetch("/api/canonical-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, code: form.code.trim().toUpperCase().replace(/\s+/g, "_"), normalBalance: form.normalBalance || undefined }) }); const result = await response.json(); setSaving(false); if (!response.ok) { setError(result.error ?? "Gagal menyimpan account."); return; } setAccounts((items) => [...items, result.account]); setForm({ code: "", name: "", description: "", statementType: "INCOME_STATEMENT", valueNature: "FLOW", normalBalance: "" }); setOpen(false); }

  return <>
    <div className="account-toolbar"><input aria-label="Search financial dictionary" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari: piutang, receivable, inventory, goodwill..." /><button className="btn" type="button" onClick={() => setOpen(true)}>+ Add Canonical Account</button></div>
    <div className="account-summary"><span><b>{accounts.length}</b> istilah dalam kamus</span>{query && <span><b>{visible.length}</b> hasil pencarian</span>}</div>
    <div className="account-master-list">{visible.map((account) => <button type="button" className="account-master-row dictionary-row" key={account.id} onClick={() => setSelected(account)}><div><code>{account.code}</code><strong>{account.displayNameId || account.name}</strong><small>{account.name}{account.displayNameId ? ` · ${statementLabel[account.statementType]}` : ` · ${account.valueNature}`}</small></div><div className="account-flags"><span className="status">Lihat arti →</span></div></button>)}{visible.length === 0 && <p>Tidak ada istilah yang cocok. Coba kata lain atau tambahkan canonical account baru.</p>}</div>

    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="card modal dictionary-modal" onClick={(e) => e.stopPropagation()}><div className="section-title"><div><code>{selected.code}</code><h2>{selected.displayNameId || selected.name}</h2><p>{selected.name} · {statementLabel[selected.statementType]}</p></div><button className="btn secondary" onClick={() => setSelected(null)}>Tutup</button></div>
      <div className="dictionary-section"><h3>Apa itu?</h3><p>{selected.definition || selected.description || "Definisi investor sedang dilengkapi."}</p></div>
      {arr(selected.aliases).length > 0 && <div className="dictionary-section"><h3>Istilah yang mungkin muncul di laporan</h3><p>{arr(selected.aliases).join(" · ")}</p></div>}
      <div className="dictionary-section"><h3>Kenapa penting untuk investor?</h3><p>{selected.investorMeaning || "Investor note sedang dilengkapi."}</p></div>
      {arr(selected.relatedMetrics).length > 0 && <div className="dictionary-section"><h3>Analisis terkait</h3><div className="dictionary-chips">{arr(selected.relatedMetrics).map((x) => <span className="badge" key={x}>{x}</span>)}</div></div>}
      {arr(selected.positiveSignals).length > 0 && <div className="dictionary-section"><h3>Sinyal positif</h3>{arr(selected.positiveSignals).map((x) => <p className="positive" key={x}>✓ {x}</p>)}</div>}
      {arr(selected.redFlags).length > 0 && <div className="dictionary-section"><h3>Red flags</h3>{arr(selected.redFlags).map((x) => <p className="danger" key={x}>⚠ {x}</p>)}</div>}
      {sources(selected.sourceRefs).length > 0 && <div className="dictionary-section"><h3>Referensi</h3>{sources(selected.sourceRefs).map((s, i) => s.url ? <p key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.label || s.url} ↗</a></p> : <p key={i}>{s.label}</p>)}</div>}
    </div></div>}

    {open && <div className="modal-backdrop" onClick={() => setOpen(false)}><div className="card modal" onClick={(e) => e.stopPropagation()}><div className="header"><div><h2>Add Canonical Account</h2><p>Tambahkan hanya bila istilah standar memang belum tersedia.</p></div></div><div className="form-grid"><div className="field"><label>Code</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></div><div className="field"><label>Account Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div><div className="field"><label>Statement</label><select value={form.statementType} onChange={(e) => setForm({ ...form, statementType: e.target.value })}><option value="INCOME_STATEMENT">Income Statement</option><option value="BALANCE_SHEET">Balance Sheet</option><option value="CASH_FLOW">Cash Flow</option><option value="OTHER">Other</option></select></div><div className="field"><label>Value Nature</label><select value={form.valueNature} onChange={(e) => setForm({ ...form, valueNature: e.target.value })}><option value="FLOW">Flow</option><option value="STOCK">Stock</option><option value="PER_SHARE">Per Share</option><option value="RATIO">Ratio</option><option value="TEXT">Text</option></select></div><div className="field"><label>Description</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div></div>{error && <p className="danger">{error}</p>}<div className="modal-actions"><button className="btn secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save Account"}</button></div></div></div>}
  </>;
}