"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const nav = [
  ["Dashboard", "/"],
  ["Companies", "/companies"],
  ["Financial Statements", "/financial-statements"],
  ["Fundamental Analysis", "/analysis"],
  ["Data Management", "/data-management"],
  ["Settings", "/settings"],
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div>
          <div className="brand">Invest<span>AI</span></div>
          <div className="tagline">From Financial Statements<br />to Investment Decisions</div>
        </div>
        <button
          type="button"
          className="menu-toggle"
          aria-label={open ? "Tutup menu" : "Buka menu"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <nav className={`nav ${open ? "open" : ""}`}>
        {nav.map(([name, href]) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              href={href}
              key={href}
              className={active ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              {name}
            </Link>
          );
        })}
        <span className="soon">Valuation <b className="badge">Soon</b></span>
        <span className="soon">AI Assistant <b className="badge">Soon</b></span>
        <span className="soon">Portfolio <b className="badge">Soon</b></span>
      </nav>
    </aside>
  );
}
