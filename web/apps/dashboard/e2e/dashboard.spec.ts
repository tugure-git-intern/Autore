import { expect, test } from "@playwright/test";
import path from "node:path";

// npm runs workspace scripts with cwd = web/apps/dashboard, so this lands in
// web/apps/dashboard/e2e/__screenshots__/ (gitignored). Not golden tests: a
// human eyeballs these; no pixel diff is frozen.
const screenshotsDir = path.join(process.cwd(), "e2e", "__screenshots__");
const shot = (name: string) => path.join(screenshotsDir, `${name}.png`);

// Butuh sesi: `use.storageState` di playwright.config.ts memasang cookie
// `authjs.session-token` yang sah (lihat e2e/global-setup.ts).
const ROUTES = [
  { path: "/", file: "dashboard" },
  { path: "/applications", file: "applications" },
  { path: "/pipeline", file: "pipeline" },
  { path: "/security", file: "security" },
] as const;

// Publik: harus bisa dibuka tanpa sesi.
const ROUTES_PUBLIK = [
  { path: "/login", file: "login" },
  { path: "/403", file: "403" },
] as const;

test.describe("Autore dashboard visual contract @1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("page heading is visible and nothing overflows 1280px wide", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, "documentElement.scrollWidth").toBeLessThanOrEqual(1280);
  });

  test("sesi dari storageState benar-benar terbaca", async ({ page }) => {
    await page.goto("/");
    // UserMenu hanya dirender kalau `currentUser()` mengembalikan login (lihat
    // navbar.tsx:83). Jadi assert ini membuktikan cookie e2e diterima server,
    // bukan sekadar tidak error.
    await page.locator("header summary").click();
    await expect(page.getByText("@alif")).toBeVisible();
    await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
  });

  test("sidebar exposes four destinations including Keamanan", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator('aside nav[aria-label="Navigasi utama"]');
    await expect(sidebar).toBeVisible();
    // Sidebar copy is Indonesian (Ringkasan/Aplikasi/Pipeline/Keamanan); assert
    // by route so the destinations stay pinned to the real hrefs even if the
    // wording changes.
    for (const href of ["/", "/applications", "/pipeline", "/security"]) {
      await expect(sidebar.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await expect(sidebar.locator("a")).toHaveCount(4);
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
      // Tailwind menyisipkan layer `rgba(0,0,0,0)` (placeholder ring) di depan
      // setiap box-shadow; lapisan transparan itu bukan elevasi. Ambang 3px =
      // blur `shadow-sm` di Tailwind v4 (0 1px 3px); di atas itu elevasi lebih
      // berat (shadow-md ke atas) dan berarti desainnya menyimpang.
      const isAtMostShadowSm = (value: string) => {
        const layers = value.split(/,(?![^(]*\))/);
        return layers
          .filter((layer) => !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(layer))
          .every((layer) => {
            const px = layer.match(/-?\d+(?:\.\d+)?px/g) ?? [];
            return px[2] === undefined || parseFloat(px[2]) <= 3;
          });
      };
      const gradients: string[] = [];
      const heavyShadows: string[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const style = getComputedStyle(el);
        if (/gradient\(/i.test(style.backgroundImage)) gradients.push(describe(el));
        const shadow = style.boxShadow;
        if (shadow && shadow !== "none" && !isAtMostShadowSm(shadow)) {
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

// Tanpa sesi sama sekali: konteks baru, bukan sekadar menghapus cookie di
// konteks yang sudah punya storageState.
test.describe("tanpa sesi", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of ["/", "/applications", "/pipeline", "/security"]) {
    test(`${route} dialihkan ke /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    });
  }

  test("halaman /login tetap publik dan menawarkan login GitHub", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /github/i })).toBeVisible();
  });

  test("POST /api/actions/deploy dijawab 401, bukan dijalankan", async ({ request }) => {
    const response = await request.post("/api/actions/deploy", { data: { app: "tes-web" } });

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, status: 401 });
  });

  test("GET /api/status tetap terbuka (hanya baca)", async ({ request }) => {
    const response = await request.get("/api/status");

    expect(response.status()).toBe(200);
  });
});

test.describe("halaman publik @1280x720", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 720 } });

  for (const route of ROUTES_PUBLIK) {
    test(`captures ${route.path} at 1280x720`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.locator("body")).toBeVisible();
      await page.screenshot({ path: shot(route.file), fullPage: false });
    });
  }
});
