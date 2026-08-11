"use client";

import { useRouter } from "next/navigation";

export function TrendSelector({ tickers, value }: { tickers: string[]; value: string }) {
  const router = useRouter();
  return <select className="btn secondary analysis-select" value={value} onChange={(event) => router.push(`/financial-trends?ticker=${encodeURIComponent(event.target.value)}`)} aria-label="Pilih emiten untuk melihat tren">
    {tickers.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}
  </select>;
}
