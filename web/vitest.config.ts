import { defineConfig } from "vitest/config";

// Root workspace test entry: `npm test` runs every app's suite.
// API has no vitest.config.ts of its own (plain node environment).
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      "apps/dashboard/vitest.config.ts",
      {
        test: {
          name: "api",
          root: "apps/api",
          environment: "node",
          globals: true,
          include: ["src/**/*.test.ts"],
          setupFiles: ["src/test-setup.ts"],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: "contracts",
          root: "packages/contracts",
          environment: "node",
          globals: true,
          include: ["src/**/*.test.ts"],
          passWithNoTests: true,
        },
      },
    ],
  },
});
