"use client";

import { Search } from "lucide-react";
import type { StatusFilter } from "@/lib/filter-apps";
import type { KunciTerjemah } from "@/lib/i18n";
import { useBahasa } from "./bahasa-provider";

const OPSI: ReadonlyArray<{ value: StatusFilter; label: KunciTerjemah }> = [
  { value: "all", label: "filter.semua" },
  { value: "passed", label: "filter.lulus" },
  { value: "failed", label: "filter.gagal" },
  { value: "unknown", label: "filter.tidakDiketahui" },
];

/** Filter terkendali — state tinggal di halaman, komponen ini hanya melaporkan perubahan. */
export function ApplicationsFilter({
  query,
  onQueryChange,
  status,
  onStatusChange,
  total,
  shown,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  total: number;
  shown: number;
}) {
  const { t } = useBahasa();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-[var(--color-muted)]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("filter.cari")}
          aria-label={t("filter.cariLabel")}
          className="h-9 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-sm focus:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)] dark:placeholder:text-[var(--color-muted)]"
        />
      </div>

      <div className="flex items-center gap-3">
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value as StatusFilter)}
          aria-label={t("filter.statusLabel")}
          className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]"
        >
          {OPSI.map((opsi) => (
            <option key={opsi.value} value={opsi.value}>
              {t(opsi.label)}
            </option>
          ))}
        </select>
        <p className="text-sm text-gray-500 dark:text-[var(--color-muted)]">
          {shown} {t("filter.hitungan")} {total} {t("filter.aplikasi")}
        </p>
      </div>
    </div>
  );
}
