import { isUsersPayload, type UsersPayload, type UsersSaveBody } from "@autore/contracts";

/**
 * Klien halaman Pengaturan → Pengguna & Role. Server boleh membalas 403 (role
 * berubah sejak halaman dibuka) atau 409 (revisi basi / env menimpa berkas);
 * keduanya harus sampai ke admin sebagai kalimat, bukan "HTTP 409".
 */

export class GalatPengaturan extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GalatPengaturan";
  }
}

async function pesanDari(res: Response, cadangan: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Balasan tanpa JSON (mis. halaman 403 Next.js): pakai kalimat cadangan.
  }
  return cadangan;
}

export async function fetchUsers(signal?: AbortSignal): Promise<UsersPayload> {
  const res = await fetch("/api/settings/users", {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });

  if (res.status === 403) {
    throw new GalatPengaturan("Halaman ini hanya untuk admin.", 403);
  }
  if (!res.ok) {
    throw new GalatPengaturan(await pesanDari(res, `Gagal memuat pengguna: HTTP ${res.status}`), res.status);
  }

  const json: unknown = await res.json();
  if (!isUsersPayload(json)) {
    // Bentuk asing = jangan tampilkan setengah data lalu menawarkan simpan.
    throw new GalatPengaturan("Jawaban server tidak dikenali.", res.status);
  }
  return json;
}

export async function simpanUsers(body: UsersSaveBody, signal?: AbortSignal): Promise<{ backup: string }> {
  const res = await fetch("/api/settings/users", {
    method: "PUT",
    cache: "no-store",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const json = (await res.json().catch(() => ({}))) as { backup?: unknown; error?: unknown };
  if (!res.ok) {
    const pesan =
      typeof json.error === "string" && json.error.trim()
        ? json.error
        : `Gagal menyimpan: HTTP ${res.status}`;
    throw new GalatPengaturan(pesan, res.status);
  }
  return { backup: typeof json.backup === "string" ? json.backup : "" };
}
