import { parseAllowlist, parseAllowlistEnv, roleFor, type Role } from "@autore/contracts";

/**
 * Whitelist akses: satu daftar, dua sumber. `allowed-users.json` adalah sumber
 * kebenaran; `AUTORE_ALLOWED_USERS` (dipisah koma) menimpanya kalau tidak kosong
 * — supaya operator bisa mencabut akses tanpa mengubah berkas.
 *
 * Bentuk berkas: peta login → role (`{"login":"qa"}`), atau larik string lama yang
 * berarti semua admin. Normalisasi login, pembuangan entri ber-role tidak dikenal,
 * dan pembacaan dua bentuk itu datang dari @autore/contracts: UI dan API harus
 * memakai satu urutan wewenang, dan API tidak boleh mengimpor kode apps/dashboard.
 *
 * GitHub username tidak case-sensitive, jadi setiap nama dinormalkan sebelum
 * dibandingkan. Perbandingan tanpa normalisasi = whitelist "Alif" menolak "alif".
 */

/** Larik login (bentuk lama) atau peta login → role. */
export type DaftarAllowlist = readonly string[] | ReadonlyMap<string, Role>;

export { normalizeLogin } from "@autore/contracts";

/** Peta login → role dari berkas allowlist, atau dari env yang menimpanya. */
export function allowlistMap(berkas: unknown, env: string | undefined): Map<string, Role> {
  const dariEnv = parseAllowlistEnv(env ?? "");
  if (dariEnv.size > 0) return dariEnv;
  // Entri ber-role tidak dikenal DIBUANG oleh parseAllowlist: login itu jadi tidak
  // dikenal dan ditolak. Tidak pernah dinaikkan jadi admin.
  return parseAllowlist(berkas);
}

/** Daftar mentah → peta role. Larik = semua admin; undefined = kosong (tolak semua). */
export function petaDari(daftar: DaftarAllowlist | undefined): Map<string, Role> {
  if (daftar === undefined) return new Map();
  return daftar instanceof Map ? new Map(daftar) : parseAllowlist(daftar);
}

/** Login yang boleh masuk, bentuk larik (dipertahankan untuk pemanggil lama). */
export function allowedList(berkas: unknown, envValue: string | undefined): string[] {
  return [...allowlistMap(berkas, envValue).keys()];
}

/** Daftar login dari nilai env koma (dipertahankan untuk pemanggil lama). */
export function parseAllowedUsers(raw: string | undefined): string[] {
  return [...parseAllowlistEnv(raw ?? "").keys()];
}

/**
 * Login kosong tidak pernah lolos, login di luar whitelist tidak pernah lolos, dan
 * role tidak dikenal = tidak dikenal. Daftar mentah dinormalkan di sini juga supaya
 * berkas yang ditulis manusia tidak jadi celah "salah huruf besar = ditolak".
 */
export function isAllowed(login: string, daftar: DaftarAllowlist): boolean {
  return roleFor(petaDari(daftar), login) !== null;
}
