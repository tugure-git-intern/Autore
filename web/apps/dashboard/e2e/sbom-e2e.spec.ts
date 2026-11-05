import { expect, test } from "@playwright/test";
import path from "node:path";

// Sama seperti dashboard.spec.ts: bukan golden test, manusia yang melihat PNG-nya.
const screenshotsDir = path.join(process.cwd(), "e2e", "__screenshots__");
const shot = (name: string) => path.join(screenshotsDir, `${name}.png`);

// Aplikasi yang SBOM-nya benar-benar dibangun oleh pipeline di mesin ini.
const APP = "tes-web";

test.describe("SBOM viewer @1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("tabel menampilkan dependensi hasil build tes-web", async ({ page }) => {
    await page.goto(`/applications/sbom?app=${APP}`);

    await expect(page.getByRole("heading", { name: `SBOM — ${APP}` })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Nama Library" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Versi" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Tipe" })).toBeVisible();

    // SBOM CycloneDX image ini punya ratusan paket OS + bahasa.
    const baris = page.locator("table tbody tr");
    expect(await baris.count()).toBeGreaterThan(20);

    // Tipe hanya boleh salah satu dari dua label kontrak.
    const tipe = await page.locator("table tbody tr td:nth-child(3)").allInnerTexts();
    expect(new Set(tipe.map((t) => t.trim()))).toEqual(new Set(["OS Package", "Language Package"]));

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, "documentElement.scrollWidth").toBeLessThanOrEqual(1280);

    await page.screenshot({ path: shot("sbom-tabel"), fullPage: true });
  });

  test("pencarian menyaring tabel ke library yang dicari", async ({ page }) => {
    await page.goto(`/applications/sbom?app=${APP}`);
    const cari = page.getByRole("searchbox", { name: "Cari library" });
    await expect(cari).toBeVisible();

    const sebelum = await page.locator("table tbody tr").count();
    await cari.fill("openssl");

    const sesudah = page.locator("table tbody tr");
    expect(await sesudah.count()).toBeLessThan(sebelum);
    expect(await sesudah.count()).toBeGreaterThan(0);

    const nama = await sesudah.locator("td:nth-child(1)").allInnerTexts();
    for (const n of nama) expect(n.toLowerCase()).toContain("openssl");
    await expect(page.getByText(/\d+ dari \d+ paket/)).toBeVisible();

    await page.screenshot({ path: shot("sbom-pencarian") });
  });

  test("pencarian tanpa hasil menjelaskan, bukan menampilkan tabel kosong", async ({ page }) => {
    await page.goto(`/applications/sbom?app=${APP}`);
    await page.getByRole("searchbox", { name: "Cari library" }).fill("zzz-tidak-ada-paket-ini");

    await expect(page.getByText("Tidak ada library yang cocok")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("tombol kembali membawa ke daftar aplikasi", async ({ page }) => {
    await page.goto(`/applications/sbom?app=${APP}`);

    await page.getByRole("link", { name: "Kembali ke Detail Aplikasi" }).click();

    await expect(page).toHaveURL(/\/applications$/);
    await expect(page.getByRole("heading", { name: "Aplikasi" })).toBeVisible();
  });

  test("tautan Lihat SBOM di daftar aplikasi membuka halaman ini", async ({ page }) => {
    await page.goto("/applications");

    await page.locator(`a[href="/applications/sbom?app=${APP}"]`).click();

    await expect(page).toHaveURL(new RegExp(`/applications/sbom\\?app=${APP}$`));
    await expect(page.getByRole("heading", { name: `SBOM — ${APP}` })).toBeVisible();
  });
});
