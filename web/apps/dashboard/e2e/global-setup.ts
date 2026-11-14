import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";

// `jose` (di balik `encode()`) butuh WebCrypto. Node 22 sudah menyediakannya
// sendiri; cabang ini tinggal untuk lingkungan Node lama — sama seperti
// polyfill di apps/api/src/session.ts.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

/**
 * Menulis sesi palsu yang **sah** (cookie JWE sungguhan, `encode()` dari
 * Auth.js) supaya tes bisa masuk dashboard tanpa menempuh OAuth GitHub —
 * browser otomatis tidak bisa menyelesaikan login interaktif.
 *
 * Yang dipakai: rahasia yang sama dengan unit service (`AUTH_SECRET` atau
 * `NEXTAUTH_SECRET` dari `web/.env`) dan salt = nama cookie, persis seperti
 * `middleware.ts` serta `apps/api/src/session.ts` memverifikasinya. Jadi tes
 * ini menguji jalur verifikasi nyata, bukan bypass.
 */
const NAMA_COOKIE = "authjs.session-token";
const MAX_AGE = 8 * 60 * 60;

export default async function globalSetup() {
  const rahasia = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!rahasia) {
    throw new Error(
      "AUTH_SECRET/NEXTAUTH_SECRET kosong. Jalankan lewat `npm run test:e2e` dari web/ " +
        "(script itu memuat web/.env lewat dotenv-cli).",
    );
  }

  // `next-auth/jwt` itu ESM, sedangkan globalSetup Playwright dijalankan sebagai
  // CJS — import statis langsung meledak "require() of ES Module ... not supported".
  const { encode } = await import("next-auth/jwt");

  // Login e2e harus ada di allowlist (fail-closed: login tak dikenal ditolak),
  // jadi pakai akun dev nyata, bukan nama karangan. Role ikut supaya UI role
  // teruji di jalur yang sama dengan produksi.
  const nilai = await encode({
    token: { sub: "e2e", login: "maliffadlan", name: "E2E Playwright", role: "dev" },
    secret: rahasia,
    salt: NAMA_COOKIE,
    maxAge: MAX_AGE,
  });

  const state = {
    cookies: ["127.0.0.1", "100.80.3.14"].map((domain) => ({
      name: NAMA_COOKIE,
      value: nilai,
      domain,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + MAX_AGE,
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    })),
    origins: [],
  };

  // Jalur absolut dari config supaya berkas sesi tidak mendarat di cwd pemanggil
  // (npm workspace menjalankan globalSetup dari web/, bukan apps/dashboard/).
  const dir = process.env.AUTORE_E2E_AUTH_DIR ?? path.join(process.cwd(), "e2e", ".auth");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
}
