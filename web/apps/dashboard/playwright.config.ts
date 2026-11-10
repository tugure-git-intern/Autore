import { defineConfig } from "@playwright/test";

// E2E targets the production services on 127.0.0.1:9120 (Next), which rewrites
// three Hono endpoints on 127.0.0.1:9121: /api/status, /api/runs and
// /api/actions/*. The list is explicit on purpose — a `/api/:path*` rewrite
// also swallows /api/auth/*, and GitHub login then dies with 404. Those
// processes are started outside the test run (npm run start:api /
// start:dashboard, or the systemd units), so no webServer block — the spec
// fails loudly if they are not up.
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
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://100.80.3.14:9120",
    viewport: { width: 1280, height: 720 },
    storageState: "./e2e/.auth/state.json",
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
