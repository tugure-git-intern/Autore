import { readFile, rm } from "node:fs/promises";
import { test, expect } from "@playwright/test";

// Jalur nyata dipakai mode live; mode hermetik mengarahkan keduanya ke workspace
// sementara lewat env, jadi tes tidak pernah menulis atau menghapus data VPS.
const AUDIT_LOG = process.env.AUTORE_AUDIT_LOG ?? "/home/tugure/.local/state/autore/audit.log";
const WORKSPACE = process.env.AUTORE_WORKSPACE ?? "/home/tugure/autore-workspace";

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

  test("Full Action Matrix E2E: Scan tes-web, Deploy tes-java, Quick-Start audit-test-app -> tercatat di audit.log dan tampil dengan ikon yang tepat di /audit", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const auditLogPath = AUDIT_LOG;
    const bacaAuditTerakhir = async () => {
      const isi = await readFile(auditLogPath, "utf8");
      const baris = isi.trim().split("\n").filter(Boolean);
      return JSON.parse(baris[baris.length - 1]);
    };

    // 1. Klik Scan Keamanan di aplikasi tes-web -> cek audit.log terakhir -> action: "scan", target: "tes-web"
    await page.goto("/applications");
    const rowTesWeb = page.locator("tr", { hasText: "tes-web" });
    await expect(rowTesWeb).toBeVisible();
    const [resScan] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/actions/scan") && res.request().method() === "POST",
      ),
      rowTesWeb.getByRole("button", { name: "Scan Keamanan" }).click(),
    ]);
    expect(resScan.status()).toBe(200);
    const logScan = await bacaAuditTerakhir();
    expect(logScan.action).toBe("scan");
    expect(logScan.target).toBe("tes-web");
    expect(logScan.exit).toBe(0);

    // 2. Klik Deploy (Jalankan Ulang) di aplikasi tes-java -> cek log -> action: "deploy", target: "tes-java"
    const rowTesJava = page.locator("tr", { hasText: "tes-java" });
    await expect(rowTesJava).toBeVisible();
    await rowTesJava.getByRole("link", { name: "Detail" }).click();
    await expect(page).toHaveURL(/\/pipeline\?app=tes-java/);
    await page.getByRole("button", { name: "Jalankan Ulang" }).click();
    const [resDeploy] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/actions/deploy") && res.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Ya, jalankan ulang" }).click(),
    ]);
    expect(resDeploy.status()).toBe(200);
    const logDeploy = await bacaAuditTerakhir();
    expect(logDeploy.action).toBe("deploy");
    expect(logDeploy.target).toBe("tes-java");
    expect(logDeploy.exit).toBe(0);

    // 3. Klik Buat Aplikasi Baru (nama audit-test-app) -> cek log -> action: "quick-start", target: "audit-test-app"
    await rm(`${WORKSPACE}/audit-test-app`, { recursive: true, force: true });
    await page.goto("/applications");
    await page.getByRole("button", { name: "Buat Aplikasi Baru" }).click();
    await page.getByLabel("Nama Aplikasi").fill("audit-test-app");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByLabel("Ketik nama aplikasi untuk konfirmasi").fill("audit-test-app");
    const [resQuickStart] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/actions/quick-start") && res.request().method() === "POST",
        { timeout: 90_000 },
      ),
      page.getByRole("button", { name: "Buat Aplikasi", exact: true }).click(),
    ]);
    expect(resQuickStart.status()).toBe(200);
    const logQuickStart = await bacaAuditTerakhir();
    expect(logQuickStart.action).toBe("quick-start");
    expect(logQuickStart.target).toBe("audit-test-app");
    expect(logQuickStart.exit).toBe(0);

    // 4. Cek di halaman /audit: pastiin tampilannya bener (Scan = ikon Shield, Deploy = ikon Rocket, Quick-Start = ikon Plus)
    await page.goto("/audit");
    const rail = page.getByTestId("audit-rail");
    await expect(rail).toBeVisible();

    const items = page.locator("ol li");
    const itemQuickStart = items.nth(0);
    const itemDeploy = items.nth(1);
    const itemScan = items.nth(2);

    await expect(itemQuickStart).toContainText("audit-test-app");
    await expect(itemQuickStart).toContainText("membuat proyek baru pada");
    await expect(itemQuickStart.locator("svg.lucide-circle-plus, svg.lucide-plus-circle")).toBeVisible();

    await expect(itemDeploy).toContainText("tes-java");
    await expect(itemDeploy).toContainText("melakukan Deploy pada");
    await expect(itemDeploy.locator("svg.lucide-rocket")).toBeVisible();

    await expect(itemScan).toContainText("tes-web");
    await expect(itemScan).toContainText("memindai keamanan pada");
    await expect(itemScan.locator("svg.lucide-shield-check")).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      localStorage.setItem("autore-theme", "dark");
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/audit-action-matrix-dark.png", fullPage: true });

    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("autore-theme", "light");
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/audit-action-matrix-light.png", fullPage: true });
  });
});
