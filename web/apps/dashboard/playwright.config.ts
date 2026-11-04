import { defineConfig } from "@playwright/test";

// E2E targets the production services on 127.0.0.1:9120 (Next) which proxy
// /api/* to 127.0.0.1:9121 (Hono). Those processes are started outside the
// test run (npm run start:api / npm run start:dashboard, or the systemd units),
// so no webServer block — the spec fails loudly if they are not up.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:9120",
    viewport: { width: 1280, height: 720 },
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
  projects: [{ name: "chromium" }],
});
