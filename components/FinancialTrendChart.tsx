"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { period: string; revenue: number | null; grossProfit: number | null; netProfitParent: number | null; ocf: number | null; fcf: number | null };
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function FinancialTrendChart({ points, currency }: { points: Point[]; currency: string }) {
  return <div className="trend-chart" aria-label={`Grafik tren dalam ${currency}`}><ResponsiveContainer width="100%" height={360}>
    <LineChart data={points} margin={{ top: 10, right: 12, left: 4, bottom: 5 }}>
      <CartesianGrid stroke="#203751" strokeDasharray="3 3" />
      <XAxis dataKey="period" stroke="#93a8bd" />
      <YAxis stroke="#93a8bd" tickFormatter={compact} width={72} />
      <Tooltip formatter={(value) => value == null ? "N/A" : `${currency} ${compact(Number(value))}`} contentStyle={{ background: "#0d1b2d", border: "1px solid #203751", borderRadius: 10 }} />
      <Legend />
      <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#5aa9ff" strokeWidth={2.5} connectNulls={false} />
      <Line type="monotone" dataKey="grossProfit" name="Gross Profit" stroke="#31d69b" strokeWidth={2.5} connectNulls={false} />
      <Line type="monotone" dataKey="netProfitParent" name="Net Profit Parent" stroke="#ffbd59" strokeWidth={2.5} connectNulls={false} />
      <Line type="monotone" dataKey="ocf" name="OCF" stroke="#b48cff" strokeWidth={2.5} connectNulls={false} />
      <Line type="monotone" dataKey="fcf" name="FCF" stroke="#ff6b76" strokeWidth={2.5} connectNulls={false} />
    </LineChart>
  </ResponsiveContainer></div>;
}
