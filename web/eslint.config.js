// Flat config ESLint untuk monorepo web/. Aturan TypeScript saja: paket yang
// sudah ada tidak memuat plugin React/Next, dan menambahkannya cuma untuk lint
// berarti dependensi baru tanpa aturan yang benar-benar dipakai di sini.
// Sengaja tanpa aturan ber-tipe (type-aware): lint harus jalan tanpa build.
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    // Hasil build, dependensi, dan artefak e2e bukan sumber yang dilint.
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.config.js",
      // Dihasilkan Next; Next sendiri melarang menyuntingnya.
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      // Argumen/var tak terpakai yang diawali "_" memang disengaja.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
