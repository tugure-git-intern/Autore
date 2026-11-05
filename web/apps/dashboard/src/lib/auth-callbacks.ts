import { isAllowed, normalizeLogin } from "./allowlist";

/**
 * Callback Auth.js versi murni: tanpa import runtime dari `next-auth`, sehingga
 * bisa diuji tanpa mock. Tipe lokal dipakai supaya berkas ini tidak menyeret
 * dependensi Next ke dalam tes.
 */

export type TokenLike = Record<string, unknown> & { login?: string };
export type SessionLike = { user?: Record<string, unknown>; expires?: string };

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
export function stampLogin(params: { token: TokenLike; profile?: unknown }): TokenLike {
  return { ...params.token, login: githubLogin(params.profile) };
}

export function exposeLogin(params: { session: SessionLike; token: TokenLike }): SessionLike {
  return {
    ...params.session,
    user: { ...params.session.user, login: params.token.login ?? "" },
  };
}
