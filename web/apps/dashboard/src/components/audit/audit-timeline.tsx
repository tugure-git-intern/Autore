"use client";

import { useMemo, useState } from "react";
import { PlusCircle, Rocket, Search, SearchX, ShieldCheck } from "lucide-react";
import type { AuditEntry } from "@/lib/audit-client";
import { inisial, relativeTime } from "@/lib/format";

export interface AuditTimelineProps {
  entries: AuditEntry[];
}

function getActionInfo(action: string) {
  switch (action) {
    case "deploy":
      return {
        label: "Deploy",
        verb: "melakukan Deploy pada",
        icon: Rocket,
        iconTone: "bg-blue-50 text-blue-600 border-blue-200 dark:border-blue-800 dark:bg-blue-950/80 dark:text-blue-300",
      };
    case "scan":
      return {
        label: "Scan",
        verb: "memindai keamanan pada",
        icon: ShieldCheck,
        iconTone: "bg-emerald-50 text-emerald-600 border-emerald-200 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300",
      };
    case "quick-start":
      return {
        label: "Quick-Start",
        verb: "membuat proyek baru pada",
        icon: PlusCircle,
        iconTone: "bg-purple-50 text-purple-600 border-purple-200 dark:border-purple-800 dark:bg-purple-950/80 dark:text-purple-300",
      };
    default:
      return {
        label: action,
        verb: `menjalankan ${action} pada`,
        icon: Rocket,
        iconTone: "bg-gray-50 text-gray-600 border-gray-200 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-muted)]",
      };
  }
}

export function AuditTimeline({ entries }: AuditTimelineProps) {
  // Beda antara "log belum pernah diisi" dan "filter tidak menemukan apa pun":
  // pesan filter di log kosong menyesatkan.
  const kosong = entries.length === 0;
  const [query, setQuery] = useState("");
  const [filterAksi, setFilterAksi] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = useMemo(() => {
    return entries.filter((item) => {
      // Query filter
      if (query.trim()) {
        const q = query.toLowerCase();
        // Baris lama atau hasil sunting tangan bisa kehilangan field: jangan sampai
        // mengetik di kotak pencarian melempar TypeError dan memutihkan halaman.
        const matchUser = (item.login ?? "").toLowerCase().includes(q);
        const matchEmail = (item.email ?? "").toLowerCase().includes(q);
        const matchTarget = (item.target ?? "").toLowerCase().includes(q);
        if (!matchUser && !matchEmail && !matchTarget) return false;
      }

      // Action filter
      if (filterAksi !== "all" && item.action !== filterAksi) {
        return false;
      }

      // Status filter
      if (filterStatus === "success" && item.exit !== 0) return false;
      if (filterStatus === "failed" && item.exit === 0) return false;

      return true;
    });
  }, [entries, query, filterAksi, filterStatus]);

  const resetFilter = () => {
    setQuery("");
    setFilterAksi("all");
    setFilterStatus("all");
  };

  return (
    <div className="space-y-6">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-[var(--color-muted)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari pengguna atau nama aplikasi..."
            aria-label="Cari log audit"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)] dark:placeholder:text-[var(--color-muted)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <div>
            <label htmlFor="filter-aksi" className="sr-only">Filter Aksi</label>
            <select
              id="filter-aksi"
              aria-label="Filter aksi"
              value={filterAksi}
              onChange={(e) => setFilterAksi(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]"
            >
              <option value="all">Semua Aksi</option>
              <option value="deploy">Deploy</option>
              <option value="scan">Scan</option>
              <option value="quick-start">Quick-Start</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="sr-only">Filter Status</label>
            <select
              id="filter-status"
              aria-label="Filter status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]"
            >
              <option value="all">Semua Status</option>
              <option value="success">Sukses</option>
              <option value="failed">Gagal</option>
            </select>
          </div>
        </div>
      </div>

      {/* Activity Feed / Empty State */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]">
          <div className="mb-3 rounded-full bg-gray-50 p-3 text-gray-400 dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-muted)]">
            <SearchX className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-[var(--color-ink)]">
            {kosong ? "Belum ada aktivitas" : "Tidak ada aktivitas yang cocok"}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-[var(--color-muted)]">
            {kosong
              ? "Deploy, scan, dan quick-start akan tercatat di sini."
              : "Coba ubah kata kunci pencarian atau reset filter."}
          </p>
          {kosong ? null : (
            <button
              type="button"
              onClick={resetFilter}
              className="mt-4 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)] dark:text-[var(--color-ink)] dark:hover:bg-[var(--bg-sidebar)]"
            >
              Reset Filter
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          {/* Satu tarikan dari kartu pertama ke kartu terakhir. Diletakkan di pembungkus
              feed (bukan di dalam kartu) dan diberi lapisan di atas kartu putih, jadi
              celah antar kartu tidak memutus garis. Avatarlah yang menimpanya. */}
          <div
            aria-hidden="true"
            data-testid="audit-rail"
            className="absolute bottom-0 left-9 top-0 z-10 w-0.5 -translate-x-1/2 bg-gray-200 sm:left-10 dark:bg-[var(--color-line)]"
          />

          <ol className="relative space-y-4">
            {filtered.map((item, idx) => {
              const { verb, icon: ActionIcon, iconTone } = getActionInfo(item.action);
              const isSuccess = item.exit === 0;
              const tanpaStatus = typeof item.exit !== "number";

              return (
                <li
                  key={`${item.ts}-${item.target}-${idx}`}
                  className="relative flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50/60 sm:gap-4 sm:p-5 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)] dark:hover:bg-[var(--bg-sidebar)]"
                >
                  {/* User Avatar + Action Pin */}
                  <div data-testid="audit-avatar" className="relative z-20 shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 ring-2 ring-[#fafafa] dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-[#353b43]">
                      {inisial(item.login || "?")}
                    </div>
                    <div
                      aria-hidden="true"
                      className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border ${iconTone}`}
                    >
                      <ActionIcon className="h-3 w-3" />
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm text-gray-700 dark:text-[var(--color-muted)]">
                        <span className="font-semibold text-gray-900 dark:text-[var(--color-ink)]">{item.login || "tanpa-sesi"}</span>
                        <span>{verb}</span>
                        <code className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]">
                          {item.target}
                        </code>
                      </div>

                      {/* Status Badge */}
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          tanpaStatus
                            ? "border-gray-200 bg-gray-50 text-gray-600 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-muted)]"
                            : isSuccess
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300"
                        }`}
                      >
                        {tanpaStatus ? "Tanpa status" : isSuccess ? "Sukses" : `Gagal (${item.exit})`}
                      </span>
                    </div>

                    {/* Metadata Footer */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-[var(--color-muted)]">
                      <time dateTime={item.ts} title={new Date(item.ts).toLocaleString("id-ID")}>
                        {relativeTime(item.ts)}
                      </time>
                      {item.email ? (
                        <>
                          <span className="text-gray-300 dark:text-[var(--color-line)]">•</span>
                          <span className="truncate">{item.email}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
