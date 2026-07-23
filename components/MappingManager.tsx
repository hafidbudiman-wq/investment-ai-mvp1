"use client";

import { useMemo, useState } from "react";
import type { CanonicalAccountItem } from "@/components/CanonicalAccountManager";

type Mapping = { id?: string; reported: string; canonical: string; canonicalAccountId: string };

export function MappingManager({ initialMappings, accounts }: { initialMappings: Mapping[]; accounts: CanonicalAccountItem[] }) {
  const [mappings, setMappings] = useState(initialMappings);
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState("");
  const [canonicalAccountId, setCanonicalAccountId] = useState(accounts[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canSave = useMemo(() => Boolean(reported.trim() && canonicalAccountId), [reported, canonicalAccountId]);

  async function addMapping() {
    if (!canSave) return;
    setSaving(true); setError("");
    const account = accounts.find((item) => item.id === canonicalAccountId);
    const response = await fetch("/api/account-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceLabel: reported.trim(), canonicalAccountId, statementType: account?.statementType }) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) { setError(result.error ?? "Gagal menyimpan mapping."); return; }
    const saved = result.mapping;
    setMappings((items) => [...items.filter((item) => item.reported !== saved.sourceLabel), { id: saved.id, reported: saved.sourceLabel, canonical: saved.canonicalAccount.name, canonicalAccountId: saved.canonicalAccount.id }]);
    setReported(""); setOpen(false);
  }

  return <>
    <button className="btn" type="button" disabled={accounts.length === 0} onClick={() => setOpen(true)}>+ Add Mapping</button>
    <p className="helper-text">Mapping menerjemahkan nama akun asli perusahaan ke Canonical Account InvestAI. Mapping yang disimpan sekarang permanen di PostgreSQL.</p>
    <div className="mapping-list"><div className="mapping-row mapping-head"><span>Reported Account</span><span>Canonical Account</span></div>{mappings.map((mapping, index) => <div className="mapping-row" key={mapping.id ?? `${mapping.reported}-${index}`}><span>{mapping.reported}</span><span>{mapping.canonical}</span></div>)}{mappings.length === 0 && <p>Belum ada mapping tersimpan.</p>}</div>
    {open && <div className="modal-backdrop" onClick={() => setOpen(false)}><div className="card modal" onClick={(event) => event.stopPropagation()}><div className="header"><div><h2>Add Account Mapping</h2><p>Hubungkan nama akun laporan perusahaan ke akun standar InvestAI.</p></div></div><div className="form-grid"><div className="field"><label>Reported Account</label><input value={reported} onChange={(event) => setReported(event.target.value)} placeholder="Contoh: Penjualan Neto" /></div><div className="field"><label>Canonical Account</label><select value={canonicalAccountId} onChange={(event) => setCanonicalAccountId(event.target.value)}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></div></div>{error && <p className="danger">{error}</p>}<div className="modal-actions"><button className="btn secondary" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="btn" type="button" disabled={!canSave || saving} onClick={addMapping}>{saving ? "Saving..." : "Save Mapping"}</button></div></div></div>}
  </>;
}
