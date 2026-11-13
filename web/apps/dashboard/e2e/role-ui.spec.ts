import { expect, test } from "@playwright/test";

/**
 * Gerbang approval di UI untuk sesi dev (login maliffadlan dari global-setup).
 * Penegakan sebenarnya ada di API; tes ini menjaga agar UI tidak menawarkan
 * aksi yang pasti ditolak.
 */
test.describe("role dev di UI", () => {
  test("badge role tampil di topbar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("badge-role")).toHaveText("Developer");
  });

  test("menu user menyebut role dari sesi", async ({ page }) => {
    await page.goto("/");
    await page.locator("header summary").click();
    await expect(page.getByTestId("role-menu")).toHaveText("Role: Developer");
  });

  test("tombol approve/reject tidak ditawarkan ke dev", async ({ page }) => {
    await page.goto("/pipeline");
    // Tunggu kerangka halaman siap sebelum menakar absennya tombol.
    await expect(page.getByRole("heading", { name: "Pipeline & Log" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Setujui" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tolak" })).toHaveCount(0);
  });
});
