"use client";

import { useRouter } from "next/navigation";

type Option = { id: string; label: string };

export function AnalysisSelector({ options, value }: { options: Option[]; value: string }) {
  const router = useRouter();
  return (
    <select
      className="btn secondary analysis-select"
      value={value}
      onChange={(event) => router.push(`/analysis?reportId=${event.target.value}`)}
      aria-label="Pilih laporan untuk dianalisis"
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  );
}
