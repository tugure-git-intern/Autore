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

test.describe("Audit Log — garis timeline", () => {
  test("garis tidak putus: setiap titik di kolomnya milik garis atau avatar, bukan kartu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/audit", { waitUntil: "networkidle" });

    const rail = page.getByTestId("audit-rail");
    const kartu = page.locator("ol > li");
    await expect(rail).toBeVisible();
    await expect(kartu.first()).toBeVisible();

    const kotakGaris = (await rail.boundingBox())!;
    const pertama = (await kartu.first().boundingBox())!;
    const terakhir = (await kartu.last().boundingBox())!;

    // Satu tarikan: dari tepi atas kartu pertama sampai tepi bawah kartu terakhir.
    expect(Math.abs(kotakGaris.y - pertama.y)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(kotakGaris.y + kotakGaris.height - (terakhir.y + terakhir.height)),
    ).toBeLessThanOrEqual(1);

    const x = kotakGaris.x + kotakGaris.width / 2;
    const sampel: number[] = [];
    for (let y = kotakGaris.y + 2; y < kotakGaris.y + kotakGaris.height - 2; y += 8) {
      sampel.push(y);
    }

    const pemilik = await page.evaluate(
      ([sumbuX, daftarY]) =>
        (daftarY as number[]).map((y) => {
          // Avatar punya banyak div di dalamnya: naik ke pembungkus ber-testid terdekat
          // supaya "titik ini milik garis" dan "titik ini milik avatar" bisa dibedakan.
          const el = document.elementFromPoint(sumbuX as number, y);
          return el?.closest("[data-testid]")?.getAttribute("data-testid") ?? el?.tagName ?? "kosong";
        }),
      [x, sampel],
    );

    // Titik yang tidak tertutup avatar wajib jatuh ke garis, bukan ke kartu putih.
    const aneh = pemilik.filter((p) => p !== "audit-rail" && p !== "audit-avatar");
    expect(aneh).toEqual([]);
    // Avatarnya benar-benar menimpa garis.
    expect(pemilik).toContain("audit-avatar");
    expect(pemilik).toContain("audit-rail");
  });

  test("garis tetap kontinu di layar HP", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/audit", { waitUntil: "networkidle" });

    const kotakGaris = (await page.getByTestId("audit-rail").boundingBox())!;
    const kartu = page.locator("ol > li");
    const pertama = (await kartu.first().boundingBox())!;
    const terakhir = (await kartu.last().boundingBox())!;

    expect(Math.abs(kotakGaris.y - pertama.y)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(kotakGaris.y + kotakGaris.height - (terakhir.y + terakhir.height)),
    ).toBeLessThanOrEqual(1);

    const lebar = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(lebar.scrollWidth).toBeLessThanOrEqual(lebar.clientWidth);
  });
});
