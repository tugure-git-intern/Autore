"use client";

import { usePathname } from "next/navigation";
import { isActiveHref, navItems } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname() ?? "/";

  return (
    <aside className="sticky top-0 hidden h-screen w-[250px] shrink-0 flex-col border-r border-gray-200 bg-white px-3 py-5 lg:flex">
      <p className="px-2 text-sm font-semibold tracking-tight text-ink">Autore</p>
      <p className="px-2 text-xs text-muted">CI/CD Workspace</p>
      <nav aria-label="Navigasi utama" className="mt-6 flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <a
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-md px-2 text-sm transition-colors ${
                active
                  ? "bg-green-50 text-green-700"
                  : "text-muted hover:bg-gray-50 hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
