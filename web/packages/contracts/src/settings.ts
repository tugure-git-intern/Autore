import { parseRole, ROLE_ORDER, type Role } from "./roles";

/**
 * Kontrak halaman Pengaturan → Pengguna & Role. Satu bentuk dipakai API (yang
 * menulis `allowed-users.json`) dan dashboard (yang menampilkannya), supaya
 * UI tidak pernah menebak bentuk jawaban server.
 */

export type EntriPengguna = { login: string; role: Role };

/**
 * `sumber` menjawab "dari mana daftar ini dibaca": berkas atau env
 * `AUTORE_ALLOWED_USERS`. `bisaDiubah` false saat env menimpa — UI wajib
 * mematikan tombol simpan, bukan menawarkan tulis yang sia-sia.
 */
export type UsersPayload = {
  sumber: "berkas" | "env";
  bisaDiubah: boolean;
  /** Sidik isi berkas saat dibaca; wajib dikirim balik pada PUT. */
  revisi: string;
  users: EntriPengguna[];
};

export type UsersSaveBody = { revisi: string; users: EntriPengguna[] };

export function isEntriPengguna(value: unknown): value is EntriPengguna {
  if (value === null || typeof value !== "object") return false;
  const item = value as { login?: unknown; role?: unknown };
  return (
    typeof item.login === "string" &&
    item.login.trim() !== "" &&
    parseRole(item.role) !== null &&
    Object.keys(value).length === 2
  );
}

export function isUsersPayload(value: unknown): value is UsersPayload {
  if (value === null || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    (body.sumber === "berkas" || body.sumber === "env") &&
    typeof body.bisaDiubah === "boolean" &&
    typeof body.revisi === "string" &&
    Array.isArray(body.users) &&
    body.users.every(isEntriPengguna) &&
    Object.keys(body).length === 4
  );
}

/** Role yang sah, untuk dropdown UI — urutan wewenang yang sama dengan API. */
export const PERAN_UI: readonly Role[] = ROLE_ORDER;

export function isUsersSaveBody(value: unknown): value is UsersSaveBody {
  if (value === null || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.revisi === "string" &&
    Array.isArray(body.users) &&
    body.users.every(isEntriPengguna) &&
    Object.keys(body).length === 2
  );
}
