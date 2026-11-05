import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Rewrite Next -> Hono ditulis satu per satu (lihat next.config.ts). Tes ini
 * menjaga daftarnya tetap eksplisit: endpoint baru harus ditambahkan, dan pola
 * liar `/api/:path*` tidak boleh kembali karena menelan `/api/auth/*`.
 */
async function rewrites() {
  const hasil = await nextConfig.rewrites?.();
  return Array.isArray(hasil) ? hasil : (hasil?.beforeFiles ?? []);
}

describe("rewrites /api ke unit Hono", () => {
  it("meneruskan /api/sbom/:app ke API loopback", async () => {
    const daftar = await rewrites();

    expect(daftar).toContainEqual({
      source: "/api/sbom/:app",
      destination: "http://127.0.0.1:9121/api/sbom/:app",
    });
  });

  it("tidak memakai pola liar yang akan menelan /api/auth/*", async () => {
    const sumber = (await rewrites()).map((r) => r.source);

    expect(sumber).not.toContain("/api/:path*");
    expect(sumber.every((s) => s !== "/api/:path*")).toBe(true);
  });

  it("masih meneruskan endpoint dashboard yang sudah dipakai", async () => {
    const sumber = (await rewrites()).map((r) => r.source);

    expect(sumber).toEqual(
      expect.arrayContaining(["/api/status", "/api/runs", "/api/active", "/api/actions/:path*"]),
    );
  });
});
