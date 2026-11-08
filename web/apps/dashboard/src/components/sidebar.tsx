"use client";

import { usePathname } from "next/navigation";
import { isActiveHref, navItems } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname() ?? "/";

  return (
    <aside className="sticky top-0 hidden h-screen w-[250px] shrink-0 flex-col rounded-r-xl border-r border-gray-200 bg-[#F0F5FE] lg:flex">
      {/* h-16 + 1px divider == the topbar block, so both dividers meet at the corner. */}
      <div
        data-testid="sidebar-brand"
        className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-200 px-6"
      >
        {/* Lockup asli Tugu Reasuransi (ikon + wordmark + tagline), latar transparan.
            h-10 + object-contain: seluruh lockup diskalakan utuh, tidak ada yang dipotong. */}
        <img
          src="/tugure-logo-asli.png"
          alt="Tugu Reasuransi"
          width={790}
          height={601}
          className="h-10 w-auto shrink-0 object-contain"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-ink">Autore</p>
          <p className="text-xs text-muted">CI/CD Workspace</p>
        </div>
      </div>
      <nav aria-label="Navigasi utama" className="flex flex-col gap-0.5 px-3 py-4">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <a
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                active
                  ? "bg-green-50 font-medium text-green-700"
                  : "text-[#545F72] hover:bg-white/60 hover:text-gray-900"
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