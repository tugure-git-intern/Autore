"use client";

import Link from "next/link";

import { usePathname } from "next/navigation";
import { useCurrentUser } from "./app-shell";
import { isActiveHref, navItemsUntuk, type HrefMenu } from "./nav-items";

/**
 * Label pendek untuk bar bawah: empat kolom di 360px tidak cukup untuk
 * "Daftar Aplikasi" dan "Pipeline & Log" tanpa terpotong.
 */
const LABEL_PENDEK: Record<HrefMenu, string> = {
  "/": "Dashboard",
  "/applications": "Aplikasi",
  "/pipeline": "Pipeline",
  "/security": "Keamanan",
  "/audit": "Audit",
  "/settings": "Setelan",
};

/**
 * Navigasi mobile: satu bar tetap di bawah, satu kolom per tujuan. Sidebar
 * desktop tetap satu-satunya navigasi di >= lg, jadi bar ini menyembunyikan
 * diri di sana — tidak pernah ada dua navigasi sekaligus.
 */
export function NavBawah() {
  const pathname = usePathname() ?? "/";
  const { role } = useCurrentUser();
  const menu = navItemsUntuk(role);

  return (
    <nav
      aria-label="Navigasi bawah"
      className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-[#F0F5FE] pb-[env(safe-area-inset-bottom)] dark:border-[#50638b] dark:bg-[#282c32] lg:hidden"
    >
      {/* Satu kolom per menu: 5 untuk non-admin, 6 untuk admin. Kolom tetap
          (bukan `grid-cols-5`) supaya label tidak terpotong saat menu bertambah. */}
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${menu.length}, minmax(0, 1fr))` }}
      >
        {menu.map(({ href, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 text-xs ${
                active
                  ? "bg-green-100 font-medium text-green-700 dark:bg-green-950/60 dark:text-green-300"
                  : "text-[#545F72] dark:text-white"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {LABEL_PENDEK[href as HrefMenu]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
