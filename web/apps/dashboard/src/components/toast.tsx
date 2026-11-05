"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type JenisToast = "sukses" | "gagal";

/** 4 detik: cukup dibaca, tidak menutupi topbar lebih lama dari perlu. */
export const DURASI_TOAST_MS = 4_000;

const JENIS = {
  sukses: {
    Ikon: CheckCircle2,
    kelas: "border-green-200 text-green-700",
    peran: "status",
  },
  gagal: {
    Ikon: AlertTriangle,
    kelas: "border-red-200 text-red-700",
    peran: "alert",
  },
} as const;

/**
 * Notifikasi hasil aksi. `sukses` = role `status` (diumumkan santai), `gagal` =
 * role `alert` (langsung dipotong). Timer ikut pesan, jadi pesan baru me-reset
 * hitungan alih-alih mewarisi sisa waktu pesan lama.
 */
export function Toast({
  pesan,
  jenis,
  onTutup,
  durasiMs = DURASI_TOAST_MS,
}: {
  pesan: string;
  jenis: JenisToast;
  onTutup: () => void;
  durasiMs?: number;
}) {
  const { Ikon, kelas, peran } = JENIS[jenis];

  useEffect(() => {
    const timer = setTimeout(onTutup, durasiMs);
    return () => clearTimeout(timer);
  }, [onTutup, durasiMs, pesan]);

  return (
    <div
      role={peran}
      data-testid="toast"
      className={`fixed bottom-4 right-4 z-20 flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm ${kelas}`}
    >
      <Ikon className="h-4 w-4" aria-hidden="true" />
      <span>{pesan}</span>
    </div>
  );
}
