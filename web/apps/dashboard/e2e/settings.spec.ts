import { expect, test } from "@playwright/test";

/**
 * Halaman Pengaturan hanya untuk admin. Sesi e2e adalah dev
 * (`maliffadlan:dev` dari global-setup, lihat playwright.config.ts), jadi menu
 * harus absen dan URL langsung harus jatuh ke /403 — bukan kerangka kosong.
 * Penegakan tulis ada di apps/api/src/settings-users.test.ts.
 */
test.describe("pengaturan untuk non-admin", () => {
  test("menu Pengaturan tidak muncul untuk dev", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByRole("navigation").first();
    await expect(sidebar.getByRole("link", { name: "Catatan Audit" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pengaturan", exact: true })).toHaveCount(0);
  });

  test("buka /settings langsung dialihkan ke halaman tolak", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/403$/);
    await expect(page.getByText(/Akses ditolak/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Pengguna & Role/ })).toHaveCount(0);
  });
});
