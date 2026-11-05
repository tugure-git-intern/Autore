import { isAllowed, normalizeLogin } from "./allowlist";

/**
 * Callback Auth.js versi murni: tanpa import runtime dari `next-auth`, sehingga
 * bisa diuji tanpa mock. Fungsi dibuat generik supaya tipe hasilnya tetap
 * kompatibel dengan tanda tangan callback Auth.js tanpa deklarasi ulang tipe
 * internalnya.
 */

/**
 * Login OAuth dari profil GitHub. Tidak ada fallback ke nama tampilan: nama
 * tampilan bukan username, dan menebaknya = meloloskan orang yang salah.
 */
export function githubLogin(profile: unknown): string {
  const p = (profile ?? {}) as { login?: unknown };
  return typeof p.login === "string" ? normalizeLogin(p.login) : "";
}

export function signInAllowed(params: { profile?: unknown }, list: readonly string[]): boolean {
  return isAllowed(githubLogin(params.profile), list);
}

/** Token tanpa login menyimpan "" supaya middleware menolaknya, bukan meloloskannya. */
export function stampLogin<T extends object>(params: {
  token: T;
  profile?: unknown;
}): T & { login: string } {
  return { ...params.token, login: githubLogin(params.profile) };
}

export function exposeLogin<S extends { user?: unknown }, T extends object>(params: {
  session: S;
  token: T;
}): S & { user: { login: string } } {
  const lama = (params.session.user ?? {}) as Record<string, unknown>;
  const login = (params.token as { login?: unknown }).login;
  const hasil = {
    ...params.session,
    user: { ...lama, login: typeof login === "string" ? login : "" },
  };
  return hasil as S & { user: { login: string } };
}
