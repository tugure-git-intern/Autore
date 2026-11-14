import path from "node:path";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

// Dua mode. Bawaan HERMETIK: suite menyalakan API (9199) dan dashboard (9198)
// sendiri, dengan binari CLI palsu + fixture JSON, jadi tidak butuh VPS,
// Jenkins, Nexus, atau ledger asli. E2E_LIVE=1 mematikan webServer dan kembali
// menempel layanan 9120/9121 seperti sebelumnya; mode itu yang dipakai untuk
// bukti lawan sistem nyata.
//
// Rewrite dashboard tetap daftar eksplisit (lihat next.config.ts): pola
// `/api/:path*` menelan /api/auth/* dan login GitHub mati dengan 404.
const HIDUP = process.env.E2E_LIVE === "1";
const PORT_API = 9199;
const PORT_WEB = 9198;
const AKAR = __dirname;
const TMP = path.join(AKAR, "e2e", ".tmp");
const STUB = path.join(AKAR, "e2e", "stub", "autore");
const FIXTURE = path.join(AKAR, "e2e", "fixtures");

// Nilai yang juga dibaca berkas spec: host cookie dan jalur audit/workspace.
// webServer mewarisi environment proses ini, jadi runner dan server melihat
// jalur yang sama.
process.env.PLAYWRIGHT_BASE_URL ??= HIDUP ? "http://100.80.3.14:9120" : `http://127.0.0.1:${PORT_WEB}`;
if (!HIDUP) {
  process.env.AUTORE_WORKSPACE = TMP;
  process.env.AUTORE_AUDIT_LOG = path.join(TMP, "audit.log");
}
process.env.AUTORE_E2E_AUTH_DIR ??= path.join(AKAR, "e2e", ".auth");

// Satu rahasia untuk server dan global-setup. `web/.env` tetap menang bila ada;
// nilai cadangan ini yang membuat suite jalan di mesin bersih tanpa .env.
process.env.AUTH_SECRET ??= "e2e-hermetik-secret-tetap";
process.env.NEXTAUTH_SECRET ??= process.env.AUTH_SECRET;
// Allowlist fail-closed: login yang di-mint global-setup wajib ada di sini.
process.env.AUTORE_ALLOWED_USERS ??= "maliffadlan:dev,tugure-git-intern:admin";

const webServer: PlaywrightTestConfig["webServer"] = HIDUP
  ? undefined
  : [
      {
        command: `rm -rf "${TMP}" && mkdir -p "${TMP}/tes-web" "${TMP}/tes-java" && cp "${FIXTURE}/audit.log" "${TMP}/audit.log" && npm run start:api`,
        cwd: path.join(AKAR, "..", ".."),
        url: `http://127.0.0.1:${PORT_API}/healthz`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          PORT: String(PORT_API),
          AUTORE_BIN: STUB,
          AUTORE_WORKSPACE: TMP,
          AUTORE_AUDIT_LOG: path.join(TMP, "audit.log"),
        },
      },
      {
        command: `npm exec -w @autore/dashboard -- next build && npm exec -w @autore/dashboard -- next start -H 127.0.0.1 -p ${PORT_WEB}`,
        cwd: path.join(AKAR, "..", ".."),
        url: `http://127.0.0.1:${PORT_WEB}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: { AUTORE_API_ASAL: `http://127.0.0.1:${PORT_API}`, AUTORE_NEXT_DIST: ".next-e2e" },
      },
    ];
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  // Sesi palsu yang sah: cookie `authjs.session-token` asli (encode() Auth.js)
  // untuk 127.0.0.1 dan 100.80.3.14. Tanpa ini dashboard hanya menampilkan
  // /login, karena satu-satunya cara masuk adalah OAuth GitHub.
  globalSetup: "./e2e/global-setup.ts",
  webServer,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    viewport: { width: 1280, height: 720 },
    storageState: path.join(AKAR, "e2e", ".auth", "state.json"),
    // Host workaround, harmless on a normal box:
    //  - the bundled headless-shell binary crashes on this kernel, so force the
    //    full chromium build (`npx playwright install chromium` ships both);
    //  - --disable-field-trial-config makes Chromium navigation hang here;
    //  - screenshots need the software GL stack (SwiftShader).
    channel: "chromium",
    launchOptions: {
      ignoreDefaultArgs: ["--disable-field-trial-config"],
      args: ["--use-gl=swiftshader", "--disable-gpu", "--disable-software-rasterizer"],
    },
  },
  // Dua project, dua ukuran layar: desktop 1280x720 (default `use`) dan HP
  // 390x844. Spec mobile hanya jalan di project mobile — menjalankannya di
  // 1280px akan mengukur tata letak yang salah.
  projects: [
    { name: "chromium", testIgnore: /mobile\.spec\.ts/ },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
