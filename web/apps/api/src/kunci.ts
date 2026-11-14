import type { ActionKind } from "./actions";

// K2: SATU ruang kunci untuk semua aksi tulis yang menyentuh satu aplikasi —
// deploy, scan, quick-start, approve, reject, rollback, promote. Kuncinya
// id aplikasi, bukan nama modul, supaya dua jalur kode berbeda tidak bisa
// menyentuh aplikasi yang sama tanpa saling melihat.
//
// Batas yang disadari: ini kunci DI DALAM proses API. Pipeline (CLI Rust) menulis
// berkas state yang sama tanpa memakai kunci ini; serialisasi lintas proses
// diserahkan ke lock berkas milik CLI (`release-state.append.lock`) dan penulisan
// atomik tmp+rename. Approval diputuskan lewat dashboard di luar jendela build,
// jadi tumpang tindih lintas proses itu diterima.

export type LabelAksi = ActionKind | "approval" | "rollback" | "promote";

const sibuk = new Map<string, LabelAksi>();

/** Kunci tulis untuk satu aplikasi; null = masih dipegang aksi lain. */
export function ambilKunci(idAplikasi: string, label: LabelAksi): (() => void) | null {
  if (sibuk.has(idAplikasi)) return null;
  sibuk.set(idAplikasi, label);
  return () => {
    // Hanya pemegang kunci yang boleh melepas. Pelepasan dari aksi lain akan
    // membuka kunci aplikasi yang masih dipakai.
    if (sibuk.get(idAplikasi) === label) sibuk.delete(idAplikasi);
  };
}

/** Label aksi yang memegang kunci aplikasi itu, atau null bila bebas. */
export function pemegangKunci(idAplikasi: string): LabelAksi | null {
  return sibuk.get(idAplikasi) ?? null;
}

/** Label aksi tulis mana pun yang sedang berjalan (gerbang untuk quick-start). */
export function aksiBerjalan(): LabelAksi | null {
  const [label] = sibuk.values();
  return label ?? null;
}

/** Lepas semua kunci — dipakai tes supaya kunci aplikasi tidak bocor antar kasus. */
export function lepasSemuaKunci(): void {
  sibuk.clear();
}
