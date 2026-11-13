import { parseRole, type Role } from "@autore/contracts";
import { isAllowed, type DaftarAllowlist } from "./allowlist";
import { roleDariAllowlist } from "./roles";

/**
 * Callback Auth.js versi murni: tanpa import runtime dari `next-auth`, sehingga
 * bisa diuji tanpa mock. Fungsi dibuat generik supaya tipe hasilnya tetap
 * kompatibel dengan tanda tangan callback Auth.js tanpa deklarasi ulang tipe
 * internalnya.
 */

/**
 * Login OAuth dari profil GitHub. Tidak ada fallback ke nama tampilan: nama
 * tampilan bukan username, dan menebaknya = meloloskan orang yang salah.
 *
 * Nilai ini dipakai untuk **ditampilkan** (UserMenu, sapaan dashboard) dan
 * sebagai author commit, jadi casing GitHub dipertahankan apa adanya
 * (`MAliffadlan`). Perbandingan whitelist tidak ikut longgar: `isAllowed`
 * menormalkan kedua sisi sebelum membandingkan.
 */
export function githubLogin(profile: unknown): string {
  const p = (profile ?? {}) as { login?: unknown };
  return typeof p.login === "string" ? p.login.trim() : "";
}

export function signInAllowed(params: { profile?: unknown }, list: DaftarAllowlist): boolean {
  return isAllowed(githubLogin(params.profile), list);
}

/**
 * Token tanpa login menyimpan "" supaya middleware menolaknya, bukan meloloskannya.
 *
 * Auth.js memanggil callback `jwt` lagi setiap kali sesi dibaca (tanpa `profile`),
 * jadi login yang sudah ada harus dipertahankan — kalau tidak, user yang sah
 * kehilangan identitasnya di request kedua dan dilempar ke /login.
 */
export function stampLogin<T extends object>(params: {
  token: T;
  profile?: unknown;
  daftar?: DaftarAllowlist;
}): T & { login: string; role: Role | null } {
  const dariProfil = githubLogin(params.profile);
  const lama = (params.token as { login?: unknown }).login;
  const login = dariProfil || (typeof lama === "string" ? lama : "");
  // Role ikut ke token HANYA untuk tampilan UI (menu, tombol approve). API
  // menghitung ulang role dari allowlist tiap request dan tidak pernah
  // mempercayai nilai di token; saat sesi dibaca ulang (tanpa `profile`) role
  // lama dipertahankan supaya menu tidak berkedip — dan login lama tetap
  // dipertahankan supaya user yang sah tidak kehilangan identitasnya.
  const role = dariProfil
    ? roleDariAllowlist(dariProfil, params.daftar)
    : parseRole((params.token as { role?: unknown }).role);
  return { ...params.token, login, role };
}

export function exposeLogin<S extends { user?: unknown }, T extends object>(params: {
  session: S;
  token: T;
}): S & { user: { login: string; role: Role | null } } {
  const lama = (params.session.user ?? {}) as Record<string, unknown>;
  const login = (params.token as { login?: unknown }).login;
  // Role ikut ke session user untuk tampilan; nilai null berarti token lama
  // (belum ber-role) dan UI harus memperlakukannya sebagai tanpa wewenang.
  const role = parseRole((params.token as { role?: unknown }).role);
  const hasil = {
    ...params.session,
    user: { ...lama, login: typeof login === "string" ? login : "", role },
  };
  return hasil as S & { user: { login: string; role: Role | null } };
}
