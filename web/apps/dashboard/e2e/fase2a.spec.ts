import { expect, test } from "@playwright/test";

test.describe("Fase 2A read-only", () => {
  test("halaman pipeline menampilkan deployment staging nyata tanpa aksi", async ({ page }) => {
    const response = await page.goto("/pipeline?app=tes-testing", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Sehat", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Menunggu Persetujuan", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Belum ada deployment", { exact: true })).toBeVisible();
    await expect(page.getByText("sha256:24e3fdc5344959c9ab78cae9c05d920f6ba8fc9aa2eb3706400abfe76d645036", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Environment tes-testing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deploy", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rollback", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Promote", exact: true })).toHaveCount(0);
  });

  test("GET releases berulang menghasilkan data yang sama", async ({ request }) => {
    const first = await request.get("/api/releases?app=tes-testing");
    expect(first.status()).toBe(200);
    const a = await first.json();
    const second = await request.get("/api/releases?app=tes-testing");
    const b = await second.json();
    expect(b).toEqual(a);
    expect(a.data.deployments).toHaveLength(1);
    expect(a.data.releases[0].status).toBe("menunggu_persetujuan");
    expect(a.data.environments.find((e: { nama: string }) => e.nama === "production")?.status_konfigurasi)
      .toBe("terkonfigurasi");
  });
});

