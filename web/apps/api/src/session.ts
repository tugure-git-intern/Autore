import { webcrypto } from "node:crypto";
import { getToken } from "@auth/core/jwt";
import type { MiddlewareHandler } from "hono";

// Node 18 di unit ini belum punya `globalThis.crypto`, sedangkan `jose` (dipakai
// getToken) butuh WebCrypto. Tanpa ini verifikasi sesi gagal di produksi, bukan
// cuma di tes.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

/**
 * Satu-satunya tempat di sisi API yang menyentuh `@auth/core/jwt`. Cookie-nya
 * sama persis dengan yang ditulis dashboard: JWE yang dienkripsi `AUTH_SECRET`
 * dengan `salt` = nama cookie. Jadi tidak ada session store bersama dan tidak
 * ada network hop ke Next.js.
 */
const NAMA_COOKIE = ["authjs.session-token", "__Secure-authjs.session-token"];

const normal = (teks: string) => teks.trim().toLowerCase();

export async function verifySession(request: Request, secret: string): Promise<{ login: string } | null> {
  for (const cookieName of NAMA_COOKIE) {
    const token = await getToken({ req: request, secret, salt: cookieName, cookieName }).catch(() => null);
    const login = typeof token?.login === "string" ? token.login.trim() : "";
    if (login) return { login };
  }
  return null;
}

/** Daftar koma dari env; kosong berarti tidak ada batasan tambahan di sisi API. */
export function parseAllowed(raw: string | undefined): string[] | undefined {
  const daftar = (raw ?? "")
    .split(",")
    .map(normal)
    .filter(Boolean);
  return daftar.length ? daftar : undefined;
}

/**
 * Fail closed: tanpa rahasia, aksi tidak boleh jalan sama sekali — 503, bukan
 * 200 tanpa pemeriksaan.
 */
export function requireSession(options: { secret?: string; allowed?: string[] } = {}): MiddlewareHandler {
  return async (c, next) => {
    const secret = options.secret ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
    if (!secret) {
      return c.json({ ok: false, status: 503, error: "AUTH_SECRET belum di-set di unit API" }, 503);
    }

    const sesi = await verifySession(c.req.raw, secret);
    if (!sesi) {
      return c.json({ ok: false, status: 401, error: "Session tidak sah. Login ulang di dashboard." }, 401);
    }

    if (options.allowed && !options.allowed.includes(normal(sesi.login))) {
      return c.json({ ok: false, status: 403, error: "Akun GitHub ini tidak ada di whitelist." }, 403);
    }

    await next();
  };
}
