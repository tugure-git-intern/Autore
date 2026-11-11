"use client";

import { Menu, RefreshCw } from "lucide-react";
import type { SessionUser } from "@/lib/current-user";
import { AppearanceMenu } from "./appearance-menu";
import { UserMenu } from "./user-menu";

export function Navbar({
  onSync,
  refreshing,
  user,
  sidebarTerbuka,
  onToggleSidebar,
}: {
  onSync: () => void;
  refreshing?: boolean;
  user: SessionUser;
  /** Sidebar sedang terlihat; tombol kiri topbar membalik nilainya. */
  sidebarTerbuka: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    /* z-30 + latar transparan di desktop: tombol hamburger digambar di atas kartu
       sidebar (z-20) yang warnanya sama dengan topbar, jadi tidak ada garis sambung.
       Di mobile topbar tetap solid karena konten di bawahnya ikut menggulir. */
    <header className="sticky top-0 z-10 w-full bg-[#F0F5FE] dark:bg-[#282c32]">
      {/* Padding kiri baris = lebar sidebar + celah (274px), jadi hamburger dan
          tagline duduk di atas area konten, bukan menabrak kartu sidebar.
          Saat sidebar ditutup padding menyusut ke 12px dengan transisi yang sama
          dengan konten, sehingga tombol ikut meluncur halus (bukan lompat). */}
      <div
        className={`flex h-16 items-center justify-between gap-3 px-4 transition-[padding] duration-300 ease-in-out motion-reduce:transition-none lg:pr-3 ${
          sidebarTerbuka ? "lg:pl-[274px]" : "lg:pl-3"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {/* Satu grup, isinya tetap di semua halaman: [hamburger][tagline produk].
              Hamburger tetap di topbar (bukan di dalam sidebar) supaya tombolnya hidup
              saat sidebar tertutup — kartu yang tergeser keluar layar + inert tidak bisa
              diklik. -ml-1 menarik tombol ke 12px dari tepi saat sidebar tertutup.
              Keduanya desktop saja: di mobile navigasi pindah ke bar bawah. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={sidebarTerbuka ? "Tutup sidebar" : "Buka sidebar"}
              aria-expanded={sidebarTerbuka}
              aria-controls="sidebar-utama"
              onClick={onToggleSidebar}
              className="-ml-1 hidden h-11 w-8 shrink-0 items-center justify-center rounded-md text-[#545F72] transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-white dark:hover:bg-[#353b43] lg:inline-flex"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            {/* Tagline produk, statis di semua halaman, tepat di kanan tombol. Font
                warisan Google Sans Flex dari globals.css (tanpa kelas font-*);
                text-sm font-medium = seukuran label tombol Sync; warna ikut tema. */}
            <span
              data-testid="topbar-tagline"
              className="hidden shrink-0 whitespace-nowrap text-sm font-medium leading-tight text-muted dark:text-[#c9d1d9] lg:inline-block"
            >
              Automation Tugure
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0">
          <button
            type="button"
            onClick={onSync}
            disabled={refreshing}
            aria-busy={refreshing ? "true" : undefined}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#50638b] bg-transparent px-3 py-1.5 text-sm font-medium text-[#545F72] transition-colors hover:bg-white/10 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-white dark:hover:text-white"
          >
            <RefreshCw
              className={
                refreshing
                  ? "h-4 w-4 motion-safe:animate-spin text-[#545F72] dark:text-white"
                  : "h-4 w-4 text-[#545F72] dark:text-white"
              }
              aria-hidden="true"
            />
            Sync
          </button>
          <AppearanceMenu />
          {user.login ? <UserMenu user={user} /> : null}
        </div>
      </div>
    </header>
  );
}
