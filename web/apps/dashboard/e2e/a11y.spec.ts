import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Aksesibilitas Otomatis (WCAG 2.1 AA)", () => {
  const rute = [
    { nama: "Dashboard Overview", path: "/" },
    { nama: "Pipeline & Runs", path: "/pipeline" },
    { nama: "Applications Registry", path: "/applications" },
    { nama: "SBOM Viewer", path: "/applications/sbom" },
    { nama: "Audit Log", path: "/audit" },
    { nama: "Security Center", path: "/security" },
  ];

  for (const { nama, path } of rute) {
    test(`halaman ${nama} (${path}) bebas pelanggaran a11y`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      const hasil = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      if (hasil.violations.length > 0) {
        console.error(`Pelanggaran a11y pada ${path}:`, JSON.stringify(hasil.violations, null, 2));
      }

      expect(hasil.violations).toEqual([]);
    });
  }

  test("toast di Dark Mode bebas pelanggaran a11y (WCAG 2.1 AA) dan memiliki kontras warna yang tepat", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "autore-theme",
        value: "dark",
        domain: "100.80.3.14",
        path: "/",
      },
    ]);
    await context.addInitScript(() => {
      localStorage.setItem("autore-theme", "dark");
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Sync" }).click();

    const toast = page.getByTestId("toast");
    await expect(toast).toBeVisible();

    // Pastikan warna visual dark mode sesuai spek
    await expect(toast).toHaveCSS("background-color", "rgb(201, 217, 242)");
    await expect(toast).toHaveCSS("color", "rgb(40, 44, 50)");
    await expect(toast).toHaveCSS("border-color", "rgb(80, 99, 139)");

    const hasil = await new AxeBuilder({ page })
      .include('[data-testid="toast"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(hasil.violations).toEqual([]);
  });
});
