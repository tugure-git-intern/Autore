import type { NextConfig } from "next";

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