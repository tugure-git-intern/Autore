"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type JenisToast = "sukses" | "gagal";

/**
 * Satu pintu notifikasi untuk seluruh halaman. Default no-op (pola `UserContext`)
 * supaya komponen aksi tetap bisa dirender tanpa kerangka — tes satuan, halaman
 * auth — dengan pesan yang hilang alih-alih lempar.
 */
export const ToastSink = createContext<(pesan: string, jenis: JenisToast) => void>(() => {});

export function useKirimToast() {
  return useContext(ToastSink);
}

/** 4 detik: cukup dibaca, tidak menutupi topbar lebih lama dari perlu. */
export const DURASI_TOAST_MS = 4_000;

/** Harus sama dengan durasi `toast-naik`/`toast-turun` di `globals.css`. */
const ANIMASI_TOAST_MS = 240;

// Permukaan navy gelap (#273a52) sama untuk kedua jenis; jenis pesan dibaca dari
// tint ikon, bukan dari warna teks — label tetap #eaedf3 supaya kontrasnya 9.8:1.
// Tint border ikut meredup supaya tepinya tidak jadi garis terang di atas navy.
const JENIS = {
  sukses: {
    Ikon: CheckCircle2,
    kelas: "border-green-400/40",
    ikon: "text-green-300",
    peran: "status",
  },
  gagal: {
    Ikon: AlertTriangle,
    kelas: "border-red-400/40",
    ikon: "text-red-300",
    peran: "alert",
  },
} as const;

/**
 * Notifikasi hasil aksi. `sukses` = role `status` (diumumkan santai), `gagal` =
 * role `alert` (langsung dipotong). Timer ikut pesan, jadi pesan baru me-reset
 * hitungan alih-alih mewarisi sisa waktu pesan lama.
 *
 * Tayang 4 detik, lalu turun keluar layar, baru `onTutup` dipanggil — pesan
 * tidak pernah berkedip hilang tanpa penutup.
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
  const { Ikon, kelas, ikon, peran } = JENIS[jenis];
  const [keluar, setKeluar] = useState(false);

  useEffect(() => {
    setKeluar(false);
    const mulaiTurun = setTimeout(() => setKeluar(true), durasiMs);
    const lepas = setTimeout(onTutup, durasiMs + ANIMASI_TOAST_MS);
    return () => {
      clearTimeout(mulaiTurun);
      clearTimeout(lepas);
    };
  }, [onTutup, durasiMs, pesan]);

  // Wajib sepasang dengan keyframes `globals.css`, termasuk easing-nya: naik
  // pakai cubic-bezier yang melambat di ujung, turun pakai ease-in.
  const animasi = keluar
    ? "motion-safe:animate-[toast-turun_240ms_ease-in_both]"
    : "motion-safe:animate-[toast-naik_240ms_cubic-bezier(.22,1,.36,1)_both]";

  return (
    <div
      role={peran}
      data-testid="toast"
      data-keluar={keluar}
      className={`fixed bottom-6 left-0 right-0 z-20 mx-auto w-fit flex items-center gap-2 rounded-lg border bg-[#273a52] px-3 py-2 text-sm text-[#eaedf3] shadow-lg shadow-black/30 ${animasi} ${kelas}`}
    >
      <Ikon className={`h-4 w-4 ${ikon}`} aria-hidden="true" />
      <span>{pesan}</span>
    </div>
  );
}
