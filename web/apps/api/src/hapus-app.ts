/**
 * Validasi, body, dan argv untuk aksi dashboard "Hapus Aplikasi"
 * (`autore hapus-app <nama> --konfirmasi <nama>`).
 *
 * Argv disusun di server sebagai array — modul ini tidak pernah menyentuh shell.
 * Keluaran CLI berwarna (escape ANSI + simbol ✔/✖) karena ia menulis laporan
 * langkah ke terminal; dashboard tidak boleh menerimanya mentah, jadi escape-nya
 * dibuang sebelum hasil dikirim.
 */

/** Nama field yang boleh ada di body: sisanya ditolak, bukan diabaikan diam-diam. */
const KUNCI_BODY = new Set(["app", "konfirmasi"]);

export type HasilBacaHapus =
  | { ok: true; nilai: { app: string; konfirmasi: string } }
  | { ok: false; error: string };

export function bacaBodyHapusApp(body: unknown): HasilBacaHapus {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body harus JSON {"app":"<id aplikasi>","konfirmasi":"<nama aplikasi>"}' };
  }
  const record = body as Record<string, unknown>;
  for (const kunci of Object.keys(record)) {
    if (!KUNCI_BODY.has(kunci)) {
      return { ok: false, error: `body hanya boleh memuat kunci app dan konfirmasi (ada "${kunci}")` };
    }
  }
  const app = record.app;
  if (typeof app !== "string" || !app.trim()) {
    return { ok: false, error: "app harus id aplikasi berupa string yang tidak kosong" };
  }
  const konfirmasi = record.konfirmasi;
  if (typeof konfirmasi !== "string") {
    return { ok: false, error: "konfirmasi harus berupa string" };
  }
  // Konfirmasi TIDAK di-trim: ia harus sama persis dengan nama app yang diketik user.
  return { ok: true, nilai: { app: app.trim(), konfirmasi } };
}

/** Argv tetap; kesamaan konfirmasi dengan nama app ditegakkan di aksi. */
export function argvHapusApp(nama: string, konfirmasi: string): string[] {
  return ["hapus-app", nama, "--konfirmasi", konfirmasi];
}

/** Escape warna ANSI (`ESC [ ... m`) yang dipakai CLI untuk menyorot simbol ✔/✖. */
const ANSI = /\u001b\[[0-9;]*m/g;

export function bersihkanAnsi(teks: string): string {
  return teks.replace(ANSI, "");
}
