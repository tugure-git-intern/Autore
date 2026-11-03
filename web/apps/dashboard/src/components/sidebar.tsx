import { LayoutDashboard, Layers, Workflow } from "lucide-react";

// Real routes only. No create-app entry: app registration stays in the CLI.
const navItems = [
  { href: "/", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/applications", label: "Aplikasi", icon: Layers },
  { href: "/pipeline", label: "Pipeline", icon: Workflow },
];

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white px-3 py-5 lg:flex">
      <p className="px-2 text-sm font-semibold tracking-tight text-ink">Autore</p>
      <p className="px-2 text-xs text-muted">CI/CD Workspace</p>
      <nav aria-label="Navigasi utama" className="mt-6 flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm text-muted transition-colors hover:bg-gray-50 hover:text-ink"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
