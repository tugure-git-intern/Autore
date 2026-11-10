"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ApiStatusResponse } from "@/lib/contracts";
import { useStatus } from "./app-shell";
import { isActiveHref, navItems } from "./nav-items";

/** Dibakar saat build; fallback disamakan dengan `cli/Cargo.toml`. */
export function versiAutore(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || "v0.5.9";
}

export type ToneServer = "green" | "red" | "neutral";

export type IndikatorServer = { tone: ToneServer; label: string; pulse: boolean };

/**
 * Satu-satunya penentu status koneksi di UI. `stale` berarti API menjawab
 * snapshot lama dan `failed` tarikan terakhir gagal — dua-duanya bikin data di
 * layar tidak bisa dipercaya, jadi sama-sama merah.
 */
export function indikatorServer({
  state,
  failed,
  loading,
}: {
  state: ApiStatusResponse | null;
  failed: boolean;
  loading: boolean;
}): IndikatorServer {
  if (failed || state?.stale) return { tone: "red", label: "Server Offline", pulse: false };
  if (state) return { tone: "green", label: "Server Online", pulse: true };
  return loading
    ? { tone: "neutral", label: "Memuat status", pulse: true }
    : { tone: "neutral", label: "Status belum tersedia", pulse: false };
}

const KELAS_TITIK: Record<ToneServer, string> = {
  green: "bg-green-500",
  red: "bg-red-500",
  neutral: "bg-gray-400",
};

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const { state, failed, loading } = useStatus();
  const { tone, label, pulse } = indikatorServer({ state, failed, loading });

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

      {/* Status koneksi ke API: titik + teks ikut `useStatus()`, versi di kanan */}
      <div
        data-testid="sidebar-footer"
        className="mt-auto flex items-center justify-between px-4 py-3"
      >
        <div role="status" className="flex items-center gap-2">
          <span
            aria-hidden="true"
            data-testid="server-online-dot"
            data-tone={tone}
            className={`h-2.5 w-2.5 rounded-full ${KELAS_TITIK[tone]}${pulse ? " animate-pulse" : ""}`}
          />
          <span className="text-sm font-medium text-gray-900 dark:text-white">{label}</span>
        </div>
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
          {versiAutore()}
        </span>
      </div>
    </aside>
  );
}