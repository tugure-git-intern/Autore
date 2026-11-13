import { roleFor, type Role } from "@autore/contracts";
import { petaDari, type DaftarAllowlist } from "./allowlist";

/**
 * Primitif role tinggal di @autore/contracts, bukan ditulis ulang di sini: UI dan
 * API harus memakai satu urutan wewenang, dan API (apps/api) tidak bisa mengimpor
 * kode apps/dashboard — jadi paket kontrak satu-satunya tempat yang bisa dipakai
 * bersama. Modul ini hanya menambahkan pembaca role untuk kebutuhan tampilan.
 */
export { parseRole, roleAtLeast, ROLE_ORDER } from "@autore/contracts";
export type { Role } from "@autore/contracts";

/**
 * Role login dari sumber allowlist yang sama dengan allowlist.ts; null = login di
 * luar whitelist, bukan default ke peran apa pun. Dipakai UI untuk menyembunyikan
 * kontrol yang tidak boleh ditekan — penegakan sebenarnya ada di API, yang
 * menghitung ulang role untuk tiap request dan tidak mempercayai role di token.
 */
export function roleDariAllowlist(login: string, daftar: DaftarAllowlist | undefined): Role | null {
  return roleFor(petaDari(daftar), login);
}
