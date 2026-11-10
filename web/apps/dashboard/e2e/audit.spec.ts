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
  test("garis di belakang kartu: border kartu tidak dipotong garis, garis terlihat di celah", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
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
    const pemilikDi = (sumbuX: number, sumbuY: number) =>
      page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px as number, py as number);
          return el?.closest("[data-testid]")?.getAttribute("data-testid") ?? el?.tagName ?? "kosong";
        },
        [sumbuX, sumbuY],
      );

    // Di border atas tiap kartu, titik harus milik kartu (LI), bukan garis.
    // Rail di belakang kartu, jadi border horizontal kartu tidak dipotong rail.
    const jumlah = await kartu.count();
    for (let i = 0; i < jumlah; i++) {
      const kotak = (await kartu.nth(i).boundingBox())!;
      expect(await pemilikDi(x, kotak.y + 1)).not.toBe("audit-rail");
    }

    // Garis tetap terlihat di celah antar kartu.
    const kedua = (await kartu.nth(1).boundingBox())!;
    const yCelah = pertama.y + pertama.height + (kedua.y - (pertama.y + pertama.height)) / 2;
    expect(await pemilikDi(x, yCelah)).toBe("audit-rail");

    // Avatar menimpa garis.
    const kotakAvatar = (await page.getByTestId("audit-avatar").first().boundingBox())!;
    expect(await pemilikDi(x, kotakAvatar.y + kotakAvatar.height / 2)).toBe("audit-avatar");
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
