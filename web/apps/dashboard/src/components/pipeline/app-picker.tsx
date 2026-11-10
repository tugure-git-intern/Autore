"use client";

import { useRef, type KeyboardEvent } from "react";
import type { ApplicationRecord, StatusValue } from "@/lib/contracts";
import { relativeTime } from "@/lib/format";
import { StatusBadge, type AppStatus } from "../status-badge";

/**
 * Aksen kiri mengikuti tone StatusBadge di baris yang sama (running = amber, bukan biru)
 * supaya satu baris tidak membawa dua warna berbeda untuk satu status.
 */
const AKSEN: Record<StatusValue, string> = {
  passed: "border-l-green-500",
  failed: "border-l-red-500",
  running: "border-l-amber-400",
  pending: "border-l-yellow-400",
  idle: "border-l-gray-300",
  skipped: "border-l-gray-300",
  unknown: "border-l-gray-300",
};

const TOMBOL_PINDAH: Record<string, (index: number, jumlah: number) => number> = {
  ArrowDown: (index) => index + 1,
  ArrowUp: (index) => index - 1,
  Home: () => 0,
  End: (_index, jumlah) => jumlah - 1,
};

/** Daftar aplikasi untuk kolom kiri master-detail. Presentational: seleksi dilaporkan ke halaman. */
export function AppPicker({
  applications,
  terpilih,
  onPilih,
}: {
  applications: readonly ApplicationRecord[];
  terpilih?: string;
  onPilih: (id: string) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const hitung = TOMBOL_PINDAH[event.key];
    if (!hitung) return;

    event.preventDefault();
    const tujuan = Math.min(Math.max(hitung(index, applications.length), 0), applications.length - 1);
    refs.current[tujuan]?.focus();
  };

  return (
    <nav aria-label="Daftar aplikasi">
      <ul className="divide-y divide-gray-100 dark:divide-[var(--color-line)]">
        {applications.map((app, index) => (
          <li key={app.id}>
            <button
              type="button"
              ref={(el) => {
                refs.current[index] = el;
              }}
              data-testid="app-picker-row"
              aria-current={app.id === terpilih ? "true" : undefined}
              onClick={() => onPilih(app.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`flex w-full flex-col items-start gap-1.5 border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:border-l-[var(--color-line)] dark:hover:bg-[var(--bg-sidebar)] ${
                AKSEN[app.status] ?? AKSEN.unknown
              } ${app.id === terpilih ? "bg-gray-50 dark:bg-[var(--bg-sidebar)]" : "bg-white dark:bg-[var(--bg-canvas)]"}`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">{app.name}</span>
                <StatusBadge status={app.status as AppStatus} />
              </span>
              <span className="text-xs text-muted">
                {app.last_build ? relativeTime(app.last_build) : "Belum ada build"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}