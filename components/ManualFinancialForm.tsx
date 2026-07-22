"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Company = {
  id: string;
  ticker: string;
  name: string;
};

type FormValues = {
  REV: string;
  NET_PROFIT: string;
  TOTAL_ASSETS: string;
  TOTAL_LIAB: string;
  EQUITY: string;
  OCF: string;
};

const initialValues: FormValues = {
  REV: "",
  NET_PROFIT: "",
  TOTAL_ASSETS: "",
  TOTAL_LIAB: "",
  EQUITY: "",
  OCF: "",
};

const fields: Array<{ code: keyof FormValues; label: string }> = [
  { code: "REV", label: "Revenue" },
  { code: "NET_PROFIT", label: "Net Profit" },
  { code: "TOTAL_ASSETS", label: "Total Assets" },
  { code: "TOTAL_LIAB", label: "Total Liabilities" },
  { code: "EQUITY", label: "Equity" },
  { code: "OCF", label: "Operating Cash Flow" },
];

export function ManualFinancialForm() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [year, setYear] = useState("2025");
  const [periodType, setPeriodType] = useState("FY");
  const [values, setValues] = useState<FormValues>(initialValues);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    async function loadCompanies() {
      try {
        const response = await fetch("/api/companies", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Gagal membaca perusahaan.");
        setCompanies(data.companies);
        if (data.companies.length > 0) setCompanyId(data.companies[0].id);
      } catch (error) {
        setIsError(true);
        setMessage(error instanceof Error ? error.message : "Gagal membaca perusahaan.");
      }
    }
    loadCompanies();
  }, []);

  function setField(code: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [code]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsError(false);

    if (!companyId) {
      setIsError(true);
      setMessage("Pilih perusahaan terlebih dahulu.");
      return;
    }

    const numericValues = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, Number(value)])
    );

    if (Object.values(numericValues).some((value) => !Number.isFinite(value))) {
      setIsError(true);
      setMessage("Semua nilai harus diisi dengan angka yang valid.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/financial-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          year: Number(year),
          periodType,
          audited: periodType === "FY",
          sourceFile: "Manual Web Input",
          values: numericValues,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Gagal menyimpan laporan.");

      setMessage(
        data.warnings?.length
          ? `Laporan tersimpan dengan status ${data.status}. Warning: ${data.warnings.map((item: { message: string }) => item.message).join(" ")}`
          : `Laporan berhasil disimpan dengan status ${data.status}.`
      );
      setValues(initialValues);
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Gagal menyimpan laporan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Company</label>
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required>
            {companies.length === 0 && <option value="">Loading companies...</option>}
            {companies.map((company) => (
              <option value={company.id} key={company.id}>
                {company.ticker} — {company.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Period</label>
          <select value={periodType} onChange={(event) => setPeriodType(event.target.value)}>
            <option value="FY">FY</option>
            <option value="Q1">Q1</option>
            <option value="H1">H1</option>
            <option value="Q3">Q3</option>
          </select>
        </div>
        <div className="field">
          <label>Year</label>
          <input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} required />
        </div>
        <div className="field">
          <label>Unit</label>
          <input value="Gunakan unit yang sama untuk semua angka (contoh: Rp miliar)" disabled />
        </div>
        {fields.map((field) => (
          <div className="field" key={field.code}>
            <label>{field.label}</label>
            <input
              placeholder="0"
              type="number"
              step="any"
              value={values[field.code]}
              onChange={(event) => setField(field.code, event.target.value)}
              required
            />
          </div>
        ))}
      </div>
      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={loading || companies.length === 0}>
        {loading ? "Validating & Saving..." : "Validate & Save"}
      </button>
      {message && (
        <div className={isError ? "form-message error-message" : "form-message success-message"}>
          {message}
        </div>
      )}
    </form>
  );
}
