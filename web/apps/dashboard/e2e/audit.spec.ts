import { test, expect } from "@playwright/test";

test.describe("Audit Log Feature", () => {
  test("halaman /audit merender heading, filter, dan activity feed", async ({ page }) => {
    // Kunjungi langsung halaman /audit
    await page.goto("/audit");

    // Heading utama & subtitle
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
    await expect(page.getByText("Jejak audit aktivitas operasional dan pipeline DevSecOps secara kronologis.")).toBeVisible();

    // Toolbar pencarian & filter aksi/status
    await expect(page.getByPlaceholder("Cari pengguna atau nama aplikasi...")).toBeVisible();
    await expect(page.getByLabel("Filter aksi")).toBeVisible();
    await expect(page.getByLabel("Filter status")).toBeVisible();

    // Tombol Muat Ulang
    await expect(page.getByRole("button", { name: "Muat Ulang" })).toBeVisible();
  });

  test("navigasi sidebar desktop memiliki tautan Audit Log", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    const auditNav = page.locator("aside").getByRole("link", { name: "Audit Log" });
    await expect(auditNav).toBeVisible();
    await auditNav.click();

    await expect(page).toHaveURL(/.*\/audit/);
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
  });

  test("navigasi bottom bar mobile memiliki menu Audit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const bottomAuditNav = page.locator("nav").getByRole("link", { name: "Audit" });
    await expect(bottomAuditNav).toBeVisible();
    await bottomAuditNav.click();

    await expect(page).toHaveURL(/.*\/audit/);
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
  });

  test("nol scroll horizontal di /audit pada layar mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/audit", { waitUntil: "networkidle" });

    const lebar = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(lebar.scrollWidth).toBeLessThanOrEqual(lebar.clientWidth);
  });
});
