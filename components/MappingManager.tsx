"use client";

import { useMemo, useState } from "react";

type Mapping = { reported: string; canonical: string };

export function MappingManager({ initialMappings }: { initialMappings: Mapping[] }) {
  const [mappings, setMappings] = useState(initialMappings);
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState("");
  const [canonical, setCanonical] = useState("");
  const canSave = useMemo(() => reported.trim() && canonical.trim(), [reported, canonical]);

  function addMapping() {
    if (!canSave) return;
    setMappings((items) => [...items, { reported: reported.trim(), canonical: canonical.trim() }]);
    setReported("");
    setCanonical("");
    setOpen(false);
  }

  return <>
    <button className="btn" type="button" onClick={() => setOpen(true)}>Add Mapping</button>
    <div className="mapping-list">
      <div className="mapping-row mapping-head"><span>Reported Account</span><span>Canonical Account</span></div>
      {mappings.map((mapping, index) => <div className="mapping-row" key={`${mapping.reported}-${index}`}><span>{mapping.reported}</span><span>{mapping.canonical}</span></div>)}
    </div>
    {open && <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="card modal" onClick={(event) => event.stopPropagation()}>
        <div className="header"><div><h2>Add Account Mapping</h2><p>Hubungkan nama akun laporan ke akun canonical InvestAI.</p></div></div>
        <div className="form-grid">
          <div className="field"><label>Reported Account</label><input value={reported} onChange={(event) => setReported(event.target.value)} placeholder="Contoh: Penjualan Bersih" /></div>
          <div className="field"><label>Canonical Account</label><input value={canonical} onChange={(event) => setCanonical(event.target.value)} placeholder="Contoh: Revenue" /></div>
        </div>
        <div className="modal-actions"><button className="btn secondary" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="btn" type="button" disabled={!canSave} onClick={addMapping}>Add Mapping</button></div>
        <p className="helper-text">Tahap ini mengaktifkan alur UI mapping. Penyimpanan permanen ke PostgreSQL akan menjadi langkah berikutnya bersama canonical account master.</p>
      </div>
    </div>}
  </>;
}
