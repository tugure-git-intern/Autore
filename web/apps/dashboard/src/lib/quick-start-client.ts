import { firstLine } from "./actions-client";

/**
 * Klien aksi "Buat Aplikasi Baru" (`autore quick-start`). Nama aksi, whitelist
 * bahasa, dan regex nama tetap di sini — frontend tidak pernah mengirim perintah,
 * hanya memilih salah satu nilai yang sudah dikenal.
 */

export const STACK = ["python", "nodejs", "java", "go"] as const;
export type Stack = (typeof STACK)[number];
export type Kode = "contoh" | "kosong";

/** Cermin `validate_app_name` CLI: huruf kecil/angka di awal, 1-63 karakter. */
export const NAMA_APP = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function namaSah(nama: string): boolean {
  return NAMA_APP.test(nama.trim());
}

export interface PermintaanQuickStart {
  nama: string;
  stack: Stack;
  kode: Kode;
}

export interface HasilQuickStart {
  ok: boolean;
  message: string;
  /** URL repo GitHub yang dibuat CLI, kalau barisnya terbaca di keluaran. */
  repo?: string;
  /** Diisi kalau server menolak karena sesi; pemanggil yang memindahkan halaman. */
  redirectTo?: string;
}

export async function runQuickStart(permintaan: PermintaanQuickStart): Promise<HasilQuickStart> {
  const nama = permintaan.nama.trim();

  let response: Response;
  try {
    response = await fetch("/api/actions/quick-start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nama, stack: permintaan.stack, kode: permintaan.kode }),
    });
  } catch {
    return { ok: false, message: "Gagal menghubungi server aksi. Cek jaringan lalu coba lagi." };
  }

  if (response.ok) {
    const payload = (await response.json().catch(() => null)) as { repo?: string } | null;
    return {
      ok: true,
      message: `Aplikasi "${nama}" dibuat. Build pertama sedang berjalan di Jenkins.`,
      ...(payload?.repo ? { repo: payload.repo } : {}),
    };
  }

  // 401/403 = identitas, bukan aksi: tampilkan saja akan menyisakan UI yang terus gagal.
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      message: "Sesi Anda sudah berakhir. Silakan login ulang.",
      redirectTo: "/login",
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: string; output?: string }
    | null;
  const error = payload?.error ?? `Server menolak permintaan (HTTP ${response.status}).`;
  const detail = payload?.output ? firstLine(payload.output) : "";
  return { ok: false, message: detail ? `${error} — ${detail}` : error };
}
