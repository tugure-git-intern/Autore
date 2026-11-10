import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * Versi produk satu sumber: `cli/Cargo.toml`. Dibaca saat build karena
 * `NEXT_PUBLIC_*` di-inline Next ke bundel klien; Environment= di unit
 * systemd tidak berpengaruh pada nilai yang sudah dibakar. Gagal keras
 * kalau berkasnya tak terbaca, supaya versi tidak diam-diam jatuh ke
 * fallback saat berkas hilang.
 */
function versiCli(): string {
  const toml = readFileSync(join(__dirname, "../../../cli/Cargo.toml"), "utf8");
  const cocok = toml.match(/^version\s*=\s*"([^"]+)"/m);
  if (!cocok) throw new Error("versi tidak ditemukan di cli/Cargo.toml");
  return `v${cocok[1]}`;
}

/**
 * Dashboard berbicara ke unit API lewat lima endpoint ini saja.
 *
 * Daftarnya ditulis satu per satu, **bukan** `/api/:path*`: rewrite itu juga
 * menelan `/api/auth/*`, sehingga callback GitHub diteruskan ke Hono dan
 * dijawab `404 Not Found` — gejalanya "callback 404" padahal route NextAuth-nya
 * ada dan sehat. Apa pun yang bertambah di sini harus lewat daftar ini, jangan
 * kembali ke pola liar.
 */
const API_ASAL = "http://127.0.0.1:9121";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: versiCli() },
  // Paket kontrak dikirim sebagai sumber TypeScript, bukan hasil build.
  transpilePackages: ["@autore/contracts"],
  async rewrites() {
    return [
      { source: "/api/status", destination: `${API_ASAL}/api/status` },
      { source: "/api/runs", destination: `${API_ASAL}/api/runs` },
      { source: "/api/active", destination: `${API_ASAL}/api/active` },
      { source: "/api/actions/:path*", destination: `${API_ASAL}/api/actions/:path*` },
      { source: "/api/sbom/:app", destination: `${API_ASAL}/api/sbom/:app` },
      { source: "/api/audit/log", destination: `${API_ASAL}/api/audit/log` },
    ];
  },
};

export default nextConfig;