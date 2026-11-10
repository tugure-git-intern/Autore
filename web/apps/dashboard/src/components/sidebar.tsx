"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActiveHref, navItems } from "./nav-items";

const VERSI_AUTORE = "v0.5.9";

export function Sidebar() {
  const pathname = usePathname() ?? "/";

  return (
    <aside className="fixed left-3 top-3 bottom-3 z-20 hidden w-[250px] shrink-0 flex-col rounded-2xl bg-[#F0F5FE] dark:bg-[#282c32] lg:flex">
      {/* Blok logo setinggi topbar (64px). Bingkainya memakai chrome yang sama
          dengan latar utama dan tampil tanpa border maupun bayangan: tidak ada
          gradasi tepi yang terbaca sebagai sekat vertikal. Jarak 12px dari tepi
          layar tetap dipertahankan lewat posisi `fixed`. */}
      <div
        data-testid="sidebar-brand"
        className="flex h-16 shrink-0 items-center gap-3 px-6"
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
          <p className="text-sm font-semibold tracking-tight text-ink dark:text-white">Autore</p>
          <p className="text-xs text-muted dark:text-[#c9d1d9]">CI/CD Workspace</p>
        </div>
      </div>
      <nav aria-label="Navigasi utama" className="flex flex-1 flex-col gap-0.5 px-3 py-4">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                active
                  ? "bg-green-100 font-medium text-green-700 dark:bg-green-950/60 dark:text-green-300"
                  : "text-[#545F72] hover:bg-white/60 hover:text-gray-900 dark:text-white dark:hover:bg-[#353b43] dark:hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Indikator status di pojok bawah: Server Online di kiri, versi di kanan */}
      <div
        data-testid="sidebar-footer"
        className="mt-auto flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            data-testid="server-online-dot"
            className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse"
          />
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            Server Online
          </span>
        </div>
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
          {VERSI_AUTORE}
        </span>
      </div>
    </aside>
  );
}
