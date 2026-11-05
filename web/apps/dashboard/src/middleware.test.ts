// @vitest-environment node
import { randomBytes, webcrypto } from "node:crypto";
import { encode } from "@auth/core/jwt";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// Node 18 belum punya `globalThis.crypto`; Auth.js butuh WebCrypto untuk
// membaca cookie sesi. Next menyediakannya sendiri di runtime, tes harus
// menyediakan — bukan sebaliknya (melemahkan verifikasi demi tes).
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

/**
 * Cookie di sini asli: dibuat `encode()` dari @auth/core, bukan di-mock. Jadi
 * yang teruji adalah jalur verifikasi JWE yang sama dengan produksi.
 */
const RAHASIA = randomBytes(32).toString("base64");
process.env.AUTH_SECRET = RAHASIA;
process.env.AUTORE_ALLOWED_USERS = "alif"; // menimpa allowed-users.json supaya tes deterministik
process.env.AUTH_TRUST_HOST = "true";

const { default: middleware } = await import("./middleware");

/**
 * `encode()` selalu menimpa `exp` dengan `now + maxAge`, jadi kedaluwarsa
 * disimulasikan lewat `maxAge` negatif — bukan dengan menyisipkan `exp` yang
 * akan diabaikan.
 */
async function cookieUntuk(login: string, maxAge = 3600) {
  const nilai = await encode({
    token: { login, sub: "1" },
    secret: RAHASIA,
    salt: "authjs.session-token",
    maxAge,
  });
  return `authjs.session-token=${nilai}`;
}

function minta(path: string, cookie?: string) {
  // Next selalu mengirim host + x-forwarded-proto ke middleware; tanpa keduanya
  // Auth.js menyimpulkan skema `https` dari host kosong dan mencari cookie
  // `__Secure-*`, yaitu nama yang tidak akan pernah ada di tailnet http.
  const headers = new Headers({ host: "localhost:9120", "x-forwarded-proto": "http" });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(`http://localhost:9120${path}`), { headers });
}

async function jalankan(path: string, cookie?: string): Promise<Response> {
  // Tipe wrapper `auth()` di next-auth bilang `void | Response` dan menuntut
  // argumen kedua; di runtime ia selalu mengembalikan Response.
  const panggil = middleware as unknown as (req: NextRequest) => Promise<Response | undefined>;
  const res = await panggil(minta(path, cookie));
  return res ?? new Response(null, { status: 200 });
}

function lokasi(res: Response) {
  return res.headers.get("location");
}

describe("middleware proteksi route", () => {
  it("mengarahkan ke /login saat tanpa cookie sesi", async () => {
    const res = await jalankan("/");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(new URL(lokasi(res)!).pathname).toBe("/login");
  });

  it("menyertakan callbackUrl halaman yang diminta", async () => {
    const res = await jalankan("/pipeline");
    expect(new URL(lokasi(res)!).searchParams.get("callbackUrl")).toBe("/pipeline");
  });

  it("mengarahkan ke /403 saat login tidak ada di whitelist", async () => {
    const res = await jalankan("/", await cookieUntuk("orang-lain"));
    expect(new URL(lokasi(res)!).pathname).toBe("/403");
  });

  it("meloloskan request saat cookie sah dan login ada di whitelist", async () => {
    const res = await jalankan("/applications", await cookieUntuk("Alif"));
    expect(lokasi(res)).toBeNull();
    expect(res.status).toBe(200);
  });

  it("memperlakukan token kedaluwarsa sebagai belum login", async () => {
    const cookie = await cookieUntuk("alif", -60);
    const res = await jalankan("/", cookie);
    expect(new URL(lokasi(res)!).pathname).toBe("/login");
  });

  it("menolak token yang ditandatangani rahasia lain", async () => {
    const nilai = await encode({
      token: { login: "alif", sub: "1", exp: Math.floor(Date.now() / 1000) + 60 },
      secret: randomBytes(32).toString("base64"),
      salt: "authjs.session-token",
    });
    const res = await jalankan("/", `authjs.session-token=${nilai}`);
    expect(new URL(lokasi(res)!).pathname).toBe("/login");
  });

  it("membiarkan /login, /403 dan /api/auth/* lewat tanpa cookie", async () => {
    for (const jalur of ["/login", "/403", "/api/auth/signin", "/api/auth/session"]) {
      const res = await jalankan(jalur);
      expect(lokasi(res), jalur).toBeNull();
    }
  });
});
