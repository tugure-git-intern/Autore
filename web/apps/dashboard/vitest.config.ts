import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig uses "jsx": "preserve" for Next; tests need real JSX transform.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "dashboard",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
    // next-auth mengimpor "next/server" tanpa ekstensi; Node 18 menolaknya
    // (paket `next` tidak punya peta `exports`). Di-inline supaya resolver vite
    // yang menyelesaikannya, sehingga middleware bisa diuji apa adanya.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
  },
});