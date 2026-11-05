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
 * Identitas pemanggil dari sesi dashboard. Dipakai sebagai author commit supaya
 * audit trail menunjuk orang yang menekan tombol, bukan bot. Nilainya mendarat di
 * argv CLI dan dari sana ke `.git/config`, jadi dibersihkan di sini juga.
 */
export type Identitas = { login: string; nama: string; email: string };

/**
 * Satu-satunya tempat di sisi API yang menyentuh `@auth/core/jwt`. Cookie-nya
 * sama persis dengan yang ditulis dashboard: JWE yang dienkripsi `AUTH_SECRET`
 * dengan `salt` = nama cookie. Jadi tidak ada session store bersama dan tidak
 * ada network hop ke Next.js.
 */
const NAMA_COOKIE = ["authjs.session-token", "__Secure-authjs.session-token"];

const normal = (teks: string) => teks.trim().toLowerCase();

const NAMA_MAKS = 100;

/** Alamat polos saja — tidak ada spasi, kurung sudut, atau `@` ganda. */
const EMAIL_POLOS = /^[^@\s<>]{1,64}@[^@\s<>]{1,190}$/;

/** Buang karakter kontrol: `\n` di nama bisa menyuntik baris ke `.git/config`. */
const bersih = (nilai: unknown): string =>
  typeof nilai === "string" ? nilai.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";

/**
 * Terjemahkan token Auth.js jadi identitas commit. Nama kosong jatuh ke login dan
 * email privat GitHub (`null`) jatuh ke alamat noreply resmi, supaya author tidak
 * pernah kosong. Tanpa login tidak ada identitas sama sekali (`null`).
 *
 * Login dipakai **apa adanya** (tanpa `toLowerCase`): casing GitHub itulah yang
 * ditampilkan di UI dan dicatat di `.git/config`. Normalisasi tetap ada, tapi
 * hanya untuk dua hal: perbandingan whitelist dan alamat noreply (huruf kecil
 * adalah aturan GitHub untuk `@users.noreply.github.com`).
 */
export function identitasDariToken(token: unknown): Identitas | null {
  const t = (token ?? {}) as { login?: unknown; name?: unknown; email?: unknown };
  const login = typeof t.login === "string" ? t.login.trim() : "";
  if (!login) return null;

  const namaTampilan = bersih(t.name).slice(0, NAMA_MAKS);
  // Nama tampilan yang hanya beda casing dari login tidak membawa informasi baru
  // (profil GitHub `MAliffadlan` mengisi field Name dengan "maliffadlan"), jadi
  // login yang dipakai supaya audit trail tidak kehilangan casing akunnya.
  const nama =
    namaTampilan && namaTampilan.toLowerCase() !== login.toLowerCase() ? namaTampilan : login;
  const email = bersih(t.email);
  return {
    login,
    nama,
    email: EMAIL_POLOS.test(email) ? email : `${normal(login)}@users.noreply.github.com`,
  };
}

export async function verifySession(request: Request, secret: string): Promise<Identitas | null> {
  for (const cookieName of NAMA_COOKIE) {
    const token = await getToken({ req: request, secret, salt: cookieName, cookieName }).catch(() => null);
    const identitas = identitasDariToken(token);
    if (identitas) return identitas;
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
 *
 * Sesi yang lolos disimpan di context (`sesi`) supaya aksi yang butuh identitas
 * (quick-start) tidak memverifikasi cookie untuk kedua kalinya.
 */
export function requireSession(
  options: { secret?: string; allowed?: string[] } = {},
): MiddlewareHandler<{ Variables: { sesi: Identitas } }> {
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

    c.set("sesi", sesi);
    await next();
  };
}
