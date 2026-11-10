"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { type SbomPackageType, type SbomPayload } from "@/lib/contracts";
import { dash } from "@/lib/format";
import { filterPackages } from "@/lib/filter-sbom";

/** Label yang dibaca manusia untuk `type` dari CLI. */
const TIPE: Record<SbomPackageType, string> = {
  os: "OS Package",
  language: "Language Package",
};

/**
 * Tabel dependensi + pencarian. Ratusan baris tetap dirender tanpa virtualisasi
 * (`ponytail:` batas aman ~1.000 baris; tambah paginasi kalau SBOM membengkak).
 */
export function SbomTable({ payload }: { payload: SbomPayload }) {
  const [query, setQuery] = useState("");
  const paket = filterPackages(payload.packages, query);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari library..."
            aria-label="Cari library"
            className="h-9 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-sm focus:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
          />
        </div>
        <p className="text-sm text-gray-500">
          {paket.length} dari {payload.total} paket
        </p>
      </div>

      {paket.length === 0 ? (
        <p className="p-5 text-sm text-gray-500">
          {payload.total === 0 ? "SBOM ini tidak memuat paket" : "Tidak ada library yang cocok"}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Nama Library
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Versi
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Tipe
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paket.map((p) => (
                <tr key={`${p.name}@${p.version}#${p.type}`}>
                  <td className="px-5 py-3 font-medium text-ink">{p.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted">{dash(p.version)}</td>
                  <td className="px-5 py-3 text-muted">{TIPE[p.type]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
