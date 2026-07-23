"use client";

import { useMemo, useState } from "react";

export type CanonicalAccountItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  statementType: "INCOME_STATEMENT" | "BALANCE_SHEET" | "CASH_FLOW" | "OTHER";
  valueNature: "FLOW" | "STOCK" | "PER_SHARE" | "RATIO" | "TEXT";
  normalBalance: string | null;
  isCalculated: boolean;
  formula: string | null;
};

const statementLabel: Record<CanonicalAccountItem["statementType"], string> = {
  INCOME_STATEMENT: "Income Statement",
  BALANCE_SHEET: "Balance Sheet",
  CASH_FLOW: "Cash Flow",
  OTHER: "Other",
};

export function CanonicalAccountManager({ initialAccounts }: { initialAccounts: CanonicalAccountItem[] }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ code: "", name: "", description: "", statementType: "INCOME_STATEMENT", valueNature: "FLOW", normalBalance: "" });

  const visible = useMemo(() => accounts.filter((account) => {
    const matchesType = filter === "ALL" || account.statementType === filter;
    const text = `${account.code} ${account.name} ${account.description ?? ""}`.toLowerCase();
    return matchesType && text.includes(query.toLowerCase().trim());
  }), [accounts, filter, query]);

  async function save() {
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true); setError("");
    const response = await fetch("/api/canonical-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, code: form.code.trim().toUpperCase().replace(/\s+/g, "_"), normalBalance: form.normalBalance || undefined }) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) { setError(result.error ?? "Gagal menyimpan account."); return; }
    setAccounts((items) => [...items, result.account]);
    setForm({ code: "", name: "", description: "", statementType: "INCOME_STATEMENT", valueNature: "FLOW", normalBalance: "" });
    setOpen(false);
  }

  return <>
    <div className="account-toolbar">
      <input aria-label="Search canonical accounts" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari code atau nama akun..." />
      <select aria-label="Filter statement" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ALL">All Statements</option><option value="INCOME_STATEMENT">Income Statement</option><option value="BALANCE_SHEET">Balance Sheet</option><option value="CASH_FLOW">Cash Flow</option><option value="OTHER">Other</option></select>
      <button className="btn" type="button" onClick={() => setOpen(true)}>+ Add Canonical Account</button>
    </div>
    <div className="account-summary"><span><b>{accounts.length}</b> active accounts</span><span><b>{visible.length}</b> shown</span></div>
    <div className="account-master-list">
      {visible.map((account) => <article className="account-master-row" key={account.id}><div><code>{account.code}</code><strong>{account.name}</strong><small>{statementLabel[account.statementType]} · {account.valueNature}</small></div><div className="account-flags">{account.isCalculated && <span className="badge">Calculated</span>}<span className="status">Active</span></div></article>)}
      {visible.length === 0 && <p>Tidak ada canonical account yang cocok.</p>}
    </div>
    {open && <div className="modal-backdrop" onClick={() => setOpen(false)}><div className="card modal" onClick={(e) => e.stopPropagation()}><div className="header"><div><h2>Add Canonical Account</h2><p>Tambahkan akun standar InvestAI. Gunakan hanya jika akun tersebut memang belum tersedia di master.</p></div></div><div className="form-grid">
      <div className="field"><label>Code</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Contoh: PREPAID_EXPENSE" /></div>
      <div className="field"><label>Account Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Contoh: Prepaid Expenses" /></div>
      <div className="field"><label>Statement</label><select value={form.statementType} onChange={(e) => setForm({ ...form, statementType: e.target.value })}><option value="INCOME_STATEMENT">Income Statement</option><option value="BALANCE_SHEET">Balance Sheet</option><option value="CASH_FLOW">Cash Flow</option><option value="OTHER">Other</option></select></div>
      <div className="field"><label>Value Nature</label><select value={form.valueNature} onChange={(e) => setForm({ ...form, valueNature: e.target.value })}><option value="FLOW">Flow</option><option value="STOCK">Stock</option><option value="PER_SHARE">Per Share</option><option value="RATIO">Ratio</option><option value="TEXT">Text</option></select></div>
      <div className="field"><label>Normal Balance (optional)</label><select value={form.normalBalance} onChange={(e) => setForm({ ...form, normalBalance: e.target.value })}><option value="">Not set</option><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option></select></div>
      <div className="field"><label>Description (optional)</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Keterangan penggunaan akun" /></div>
    </div>{error && <p className="danger">{error}</p>}<div className="modal-actions"><button className="btn secondary" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="btn" type="button" disabled={saving || !form.code.trim() || !form.name.trim()} onClick={save}>{saving ? "Saving..." : "Save Account"}</button></div></div></div>}
  </>;
}
