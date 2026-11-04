import { expect, test } from "@playwright/test";
import path from "node:path";

// npm runs workspace scripts with cwd = web/apps/dashboard, so this lands in
// web/apps/dashboard/e2e/__screenshots__/ (gitignored). Not golden tests: a
// human eyeballs these; no pixel diff is frozen.
const screenshotsDir = path.join(process.cwd(), "e2e", "__screenshots__");
const shot = (name: string) => path.join(screenshotsDir, `${name}.png`);

const ROUTES = [
  { path: "/", file: "dashboard" },
  { path: "/applications", file: "applications" },
  { path: "/pipeline", file: "pipeline" },
] as const;

test.describe("Autore dashboard visual contract @1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("page heading is visible and nothing overflows 1280px wide", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, "documentElement.scrollWidth").toBeLessThanOrEqual(1280);
  });

  test("sidebar exposes Dashboard, Daftar Aplikasi and Pipeline links", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator('aside nav[aria-label="Navigasi utama"]');
    await expect(sidebar).toBeVisible();
    // Sidebar copy is Indonesian (Ringkasan/Aplikasi/Pipeline); assert by route
    // so the destinations — Dashboard, app list, pipeline — stay pinned to the
    // real hrefs even if the wording changes.
    for (const href of ["/", "/applications", "/pipeline"]) {
      await expect(sidebar.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await expect(sidebar.locator("a")).toHaveCount(3);
  });

  test("no gradient backgrounds and no shadow heavier than box-shadow-sm", async ({ page }) => {
    await page.goto("/");
    const { gradients, heavyShadows } = await page.evaluate(() => {
      const describe = (el: Element) => {
        const id = el.id ? `#${el.id}` : "";
        const cls =
          typeof el.className === "string" && el.className
            ? `.${el.className.trim().split(/\s+/).join(".")}`
            : "";
        return `${el.tagName.toLowerCase()}${id}${cls}`;
      };
      // box-shadow-sm tops out at a 2px blur; anything larger is heavier elevation.
      const isShadowSmOrLess = (value: string) => {
        const layers = value.replace(/rgba?\([^)]*\)/g, "COLOR").split(",");
        return layers.every((layer) => {
          const px = layer.match(/-?\d+(?:\.\d+)?px/g) ?? [];
          const blur = px[2] === undefined ? 0 : parseFloat(px[2]);
          return blur <= 2;
        });
      };
      const gradients: string[] = [];
      const heavyShadows: string[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const style = getComputedStyle(el);
        if (/gradient\(/i.test(style.backgroundImage)) gradients.push(describe(el));
        const shadow = style.boxShadow;
        if (shadow && shadow !== "none" && !isShadowSmOrLess(shadow)) {
          heavyShadows.push(`${describe(el)} => ${shadow}`);
        }
      }
      return { gradients, heavyShadows };
    });
    expect(gradients, `gradient backgrounds: ${gradients.join(", ")}`).toEqual([]);
    expect(heavyShadows, `heavy shadows: ${heavyShadows.join(", ")}`).toEqual([]);
  });

  for (const route of ROUTES) {
    test(`captures ${route.path} at 1280x720`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.locator("body")).toBeVisible();
      await page.screenshot({ path: shot(route.file), fullPage: false });
    });
  }
});
