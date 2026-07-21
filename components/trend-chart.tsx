"use client";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trendData } from "@/lib/mock-data";

export function TrendChart() {
  return <div style={{height:300}}><ResponsiveContainer width="100%" height="100%">
    <LineChart data={trendData}>
      <XAxis dataKey="period" stroke="#93a4bb" />
      <YAxis stroke="#93a4bb" />
      <Tooltip contentStyle={{background:"#0b1829",border:"1px solid rgba(148,163,184,.2)",borderRadius:12}} />
      <Line type="monotone" dataKey="revenue" stroke="#38bdf8" strokeWidth={3} dot={false} />
      <Line type="monotone" dataKey="netProfit" stroke="#4ade80" strokeWidth={3} dot={false} />
    </LineChart>
  </ResponsiveContainer></div>;
}
