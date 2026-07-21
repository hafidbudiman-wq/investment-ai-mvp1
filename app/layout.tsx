import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata = {
  title: "Investment AI MVP 1",
  description: "Financial database for Indonesian equities"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body><div className="shell"><Sidebar /><main className="main">{children}</main></div></body></html>;
}
