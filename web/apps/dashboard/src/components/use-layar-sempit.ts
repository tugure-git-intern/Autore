"use client";

import { useEffect, useState } from "react";

const BATAS_LG = "(max-width: 1023px)";

/**
 * true kalau viewport di bawah `lg` (1024px) — breakpoint yang sama dengan
 * `Sidebar`/`NavBawah`.
 *
 * Dipakai untuk memilih *satu* tata letak, bukan menyembunyikan yang lain
 * lewat CSS: dua salinan markup berarti dua set tautan dan tombol aksi di
 * dokumen, sehingga tes jsdom (dan pembaca layar) melihat tabel dan kartu
 * sekaligus.
 *
 * Render pertama selalu `false` supaya HTML server dan klien sama; nilai
 * sebenarnya menyusul setelah mount.
 */
export function useLayarSempit(): boolean {
  const [sempit, setSempit] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.(BATAS_LG);
    if (!mq) return;

    const terapkan = () => setSempit(mq.matches);
    terapkan();
    mq.addEventListener("change", terapkan);
    return () => mq.removeEventListener("change", terapkan);
  }, []);

  return sempit;
}