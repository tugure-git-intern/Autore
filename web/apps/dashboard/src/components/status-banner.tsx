"use client";

import { AlertTriangle } from "lucide-react";

export const BANNER_GAGAL = "Gagal terhubung ke Jenkins. Menampilkan data terakhir.";
export const BANNER_BASI = "Data terakhir ditampilkan; status terbaru belum terbaca.";

/**
 * Satu banner untuk semua halaman: merah hanya saat tarikan API gagal, kuning
 * saat API masih menjawab tapi datanya basi. Jangan klaim Jenkins mati kalau
 * yang gagal cuma pembacaan snapshot.
 */
export function StatusBanner({ stale, failed }: { stale: boolean; failed: boolean }) {
  if (!failed && !stale) return null;

  const kelas = failed
    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300";

  return (
    <div
      role="alert"
      className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${kelas}`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      {failed ? BANNER_GAGAL : BANNER_BASI}
    </div>
  );
}
