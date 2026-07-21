"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AddCompanyForm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setMessage(result.error ?? "Gagal menyimpan perusahaan.");
    event.currentTarget.reset();
    setMessage("Perusahaan berhasil disimpan ke PostgreSQL.");
    router.refresh();
  }

  return <>
    <button className="btn" onClick={() => setOpen(!open)}>{open ? "Close" : "Add Company"}</button>
    {open && <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <form className="card modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>Add Company</h2>
        <div className="form-grid">
          <div className="field"><label>Ticker</label><input name="ticker" required placeholder="ICBP" /></div>
          <div className="field"><label>Company Name</label><input name="name" required placeholder="Company name" /></div>
          <div className="field"><label>Sector</label><input name="sector" placeholder="Consumer" /></div>
          <div className="field"><label>Subsector</label><input name="subsector" placeholder="Processed Foods" /></div>
          <div className="field"><label>Currency</label><select name="currency" defaultValue="IDR"><option>IDR</option><option>USD</option></select></div>
        </div>
        {message && <p>{message}</p>}
        <button className="btn" disabled={saving}>{saving ? "Saving..." : "Save to PostgreSQL"}</button>
      </form>
    </div>}
  </>;
}
