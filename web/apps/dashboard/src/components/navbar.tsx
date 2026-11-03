import type { ReactNode } from "react";
import { LayoutDashboard, Layers, Workflow } from "lucide-react";

const navItems = [
  { href: "/", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/applications", label: "Aplikasi", icon: Layers },
  { href: "/pipeline", label: "Pipeline", icon: Workflow },
];

export function Navbar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
        <p className="text-sm font-semibold tracking-tight text-ink">{title}</p>
        {children ? <div className="flex items-center gap-2">{children}</div> : null}
      </div>
      {/* Below lg the sidebar is hidden, so navigation collapses into this row. */}
      <nav aria-label="Navigasi utama" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:hidden">
        {navItems.map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted hover:bg-gray-50 hover:text-ink"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}
