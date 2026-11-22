import { firstLine } from "./actions-client";

/**
 * Klien aksi "Sambungkan Repo" (`autore connect`). Frontend hanya mengirim URL
 * repo dan nama aplikasi yang sudah lolos pola di sini; perintah dan path tetap
 * disusun server.
 */

/** Cermin `parse_repo_url` CLI: hanya https github.com, tanpa kredensial/SSH. */
export const REPO_GITHUB = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/;

export function repoSah(url: string): boolean {
  const bersih = url.trim();
  return !bersih.includes("..") && REPO_GITHUB.test(bersih);
}

/** Nama repo dipakai sebagai nama aplikasi bawaan, supaya dev tidak wajib mengisi. */
export function namaRepo(url: string): string {
  const cocok = url.trim().match(REPO_GITHUB);
  return cocok ? cocok[2] : "";
}

export interface PermintaanConnect {
  repo: string;
  nama: string;
  branch: string;
}

export interface HasilConnect {
  ok: boolean;
  message: string;
  /** URL repo GitHub yang dibaca CLI dari keluarannya. */
  repo?: string;
  /** Peringatan CLI (mis. repo belum punya endpoint /health); connect tetap sukses. */
  peringatan?: string;
  /** Diisi kalau server menolak karena sesi; pemanggil yang memindahkan halaman. */
  redirectTo?: string;
}

export async function runConnect(permintaan: PermintaanConnect): Promise<HasilConnect> {
  const repo = permintaan.repo.trim();
  const nama = permintaan.nama.trim();
  const branch = permintaan.branch.trim() || "main";

  let response: Response;
  try {
    response = await fetch("/api/actions/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo, nama, branch }),
    });
  } catch {
    return { ok: false, message: "Gagal menghubungi server aksi. Cek jaringan lalu coba lagi." };
  }

  if (response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { repo?: string; peringatan?: string }
      | null;
    return {
      ok: true,
      message: `Repo "${nama}" tersambung. Build pertama sedang berjalan di Jenkins.`,
      ...(payload?.repo ? { repo: payload.repo } : {}),
      ...(payload?.peringatan ? { peringatan: payload.peringatan } : {}),
    };
  }

  // 401/403 = identitas, bukan aksi: menampilkan pesan saja menyisakan UI yang terus gagal.
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
  // `@@AUTORE {...}` adalah baris data CLI (progress::tahap), bukan kalimat untuk user.
  const detail = payload?.output
    ? firstLine(
        payload.output
          .split("\n")
          .filter((baris) => !baris.trimStart().startsWith("@@AUTORE "))
          .join("\n"),
      )
    : "";
  return { ok: false, message: detail ? `${error} — ${detail}` : error };
}
