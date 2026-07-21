import Link from "next/link";
import { Building2, FileSpreadsheet, LayoutDashboard, Upload } from "lucide-react";

const links = [
  ["/", "Dashboard", LayoutDashboard],
  ["/companies", "Companies", Building2],
  ["/financial-statements", "Financial Statements", FileSpreadsheet],
  ["/upload-report", "Upload Report", Upload]
] as const;

export function Sidebar() {
  return <aside className="sidebar">
    <div className="brand">Investment<span>AI</span></div>
    <nav className="nav">
      {links.map(([href,label,Icon]) => <Link key={href} href={href}><Icon size={17} style={{marginRight:10,verticalAlign:"middle"}} />{label}</Link>)}
    </nav>
  </aside>;
}
