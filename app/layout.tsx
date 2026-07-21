import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "InvestAI | Stock Analysis Platform",
  description: "Financial statement database and fundamental analysis platform"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body><div className="shell"><Sidebar/><main className="main">{children}</main></div></body></html>;
}
