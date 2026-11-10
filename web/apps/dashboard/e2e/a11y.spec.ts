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
});
