"use client";

import { usePathname } from "next/navigation";
import { isActiveHref, navItems } from "./nav-items";

/**
 * Label pendek untuk bar bawah: empat kolom di 360px tidak cukup untuk
 * "Daftar Aplikasi" dan "Pipeline & Log" tanpa terpotong.
 */
const LABEL_PENDEK: Record<(typeof navItems)[number]["href"], string> = {
  "/": "Dashboard",
  "/applications": "Aplikasi",
  "/pipeline": "Pipeline",
  "/security": "Keamanan",
  "/audit": "Audit",
};

/**
 * Navigasi mobile: satu bar tetap di bawah, satu kolom per tujuan. Sidebar
 * desktop tetap satu-satunya navigasi di >= lg, jadi bar ini menyembunyikan
 * diri di sana — tidak pernah ada dua navigasi sekaligus.
 */
export function NavBawah() {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Navigasi bawah"
      className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="grid grid-cols-5">
        {navItems.map(({ href, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <a
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 text-xs ${
                active ? "bg-green-50 font-medium text-green-700" : "text-muted"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {LABEL_PENDEK[href]}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
