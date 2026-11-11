import { expect, test, type Page } from "@playwright/test";

// Kontrak yang dijaga: sidebar keluar/masuk layar dengan animasi 300ms DAN kartu
// konten ikut bergeser lewat margin-nya (bukan melompat), sementara isi topbar
// mengekor supaya tombol toggle tidak pernah ketiban kartu sidebar.
// Ukuran memakai getBoundingClientRect() agar transisi yang sedang berjalan
// terbaca; pasangan selector selalu diambil dari lokasi sungguhan (main utuh,
// header di dalam layout), bukan asumsi div-tunggal.
const SIDEBAR_X = 12;
const LEBAR_SIDEBAR = 250;
const KONTEN_TERBUKA = SIDEBAR_X + LEBAR_SIDEBAR + 12; // 274
const KONTEN_TERTUTUP = 12;

const kotakMain = (page: Page) =>
  page.locator("main").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), width: Math.round(r.width) };
  });
const kotakSidebar = (page: Page) =>
  page.locator("aside").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), right: Math.round(r.right) };
  });
/** Baris isi topbar: anak pertama <header> (header sendiri di dalam DOM memiliki div lain). */
const paddingTopbar = (page: Page) =>
  page.locator("header > div").first().evaluate((el) => getComputedStyle(el).paddingLeft);

test.describe("sidebar buka/tutup menggeser konten", () => {
  test("keadaan awal sama seperti sebelumnya: sidebar 12px, konten mulai 274px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    expect((await kotakSidebar(page)).x).toBe(SIDEBAR_X);
    expect((await kotakMain(page)).x).toBe(KONTEN_TERBUKA);
    expect(await paddingTopbar(page)).toBe(`${KONTEN_TERBUKA}px`);
    await expect(page.getByRole("button", { name: "Tutup sidebar" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("transisi margin konten dan transform sidebar terpasang 300ms ease-in-out", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    const trMain = await page.locator("main").evaluate((el) => {
      const s = getComputedStyle(el);
      return { p: s.transitionProperty, d: s.transitionDuration, e: s.transitionTimingFunction };
    });
    expect(trMain.p).toContain("margin");
    expect(trMain.d).toBe("0.3s");
    // getComputedStyle mengembalikan nilai bezier-nya, bukan keyword CSS-nya.
    expect(trMain.e).toContain("0.4, 0, 0.2, 1");

    const trSidebar = await page.locator("aside").evaluate((el) => {
      const s = getComputedStyle(el);
      return { p: s.transitionProperty, d: s.transitionDuration };
    });
    expect(trSidebar.p).toContain("transform");
    expect(trSidebar.d).toBe("0.3s");
  });

  test("menutup: sidebar keluar layar penuh dan konten meluncur ke 12px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Tutup sidebar" }).click();

    await expect.poll(async () => (await kotakMain(page)).x, { timeout: 3_000 }).toBe(KONTEN_TERTUTUP);

    // Keluar layar sepenuhnya: tepi kanan kartu sidebar tidak lagi terlihat.
    expect((await kotakSidebar(page)).right).toBeLessThanOrEqual(0);

    // Topbar ikut rapat: breadcrumb mulai setelah hamburger (12+32+8 = 52px),
    // bukan menyisakan lubang 274px.
    expect(await paddingTopbar(page)).toBe("52px");

    // Tertutup = tidak bisa di-Tab: tautan sidebar tidak boleh menerima fokus.
    await expect(page.locator("aside")).toHaveJSProperty("inert", true);
    // Mulai dari elemen yang pasti ada dan bisa difokuskan (kebab topbar),
    // bukan button pertama di main (Detail adalah <a>, dan halaman bisa
    // berhenti di keadaan skeleton/empty-state tanpa tombol apa pun).
    await page.locator("header button").first().focus();
    for (let i = 0; i < 12; i += 1) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("aside"))).toBe(false);

    await expect(page.getByRole("button", { name: "Buka sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("membuka lagi mengembalikan sidebar dan konten ke tempatnya", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Tutup sidebar" }).click();
    await expect.poll(async () => (await kotakMain(page)).x, { timeout: 3_000 }).toBe(KONTEN_TERTUTUP);

    await page.getByRole("button", { name: "Buka sidebar" }).click();

    await expect.poll(async () => (await kotakMain(page)).x, { timeout: 3_000 }).toBe(KONTEN_TERBUKA);
    await expect.poll(async () => (await kotakSidebar(page)).x, { timeout: 3_000 }).toBe(SIDEBAR_X);
    expect(await paddingTopbar(page)).toBe(`${KONTEN_TERBUKA}px`);
    await expect(page.locator("aside")).toHaveJSProperty("inert", false);

    // Lebar kartu konten ikut menyusut/meluas: tidak ada sisa ruang kosong.
    expect((await kotakMain(page)).width).toBe(1280 - KONTEN_TERBUKA - 12);
  });

  test("status buka/tutup bertahan saat berpindah halaman di dalam konten", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    // Konten sungguhan harus termuat dulu (tabel aplikasi), bukan skeleton.
    await page.getByRole("link", { name: "Detail" }).first().waitFor();

    await page.getByRole("button", { name: "Tutup sidebar" }).click();
    await expect.poll(async () => (await kotakMain(page)).x, { timeout: 3_000 }).toBe(KONTEN_TERTUTUP);

    // Sidebar yang terinert tidak bisa di-klik: buka dulu, lalu pindah halaman,
    // lalu tutup lagi — statusnya harus bertahan antar halaman (shell = layout).
    await page.getByRole("button", { name: "Buka sidebar" }).click();
    await expect.poll(async () => (await kotakMain(page)).x, { timeout: 3_000 }).toBe(KONTEN_TERBUKA);

    await page.locator("aside").getByRole("link", { name: "Daftar Aplikasi" }).click();
    await page.waitForURL(/\/applications/);

    // Shell yang sama (layout) dipertahankan: klik Tutup bekerja dan konten
    // tetap bergeser setelah navigasi client-side.
    await page.getByRole("button", { name: "Tutup sidebar" }).click();
    await expect.poll(async () => (await kotakMain(page)).x, { timeout: 3_000 }).toBe(KONTEN_TERTUTUP);
  });

  test("hamburger menempel pojok kiri topbar, tidak melayang di dekat judul konten", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    const tombolKotak = (await page.getByRole("button", { name: "Tutup sidebar" }).boundingBox())!;
    // 12px dari tepi layar: posisi yang sama saat sidebar terbuka maupun tertutup.
    expect(Math.round(tombolKotak.x)).toBe(12);

    // Ikon tiga garis (Menu), bukan ikon panel.
    await expect(page.locator("header svg.lucide-menu").first()).toBeVisible();
    await expect(page.locator("header svg.lucide-panel-left")).toHaveCount(0);

    // Tidak menabrak lockup logo: blok merek sidebar digeser ke kanan hamburger.
    const logo = (await page.getByTestId("sidebar-brand").locator("img").boundingBox())!;
    expect(Math.round(logo.x)).toBeGreaterThanOrEqual(Math.round(tombolKotak.x + tombolKotak.width));

    // Posisi tombol tidak berubah setelah sidebar ditutup: tetap di pojok kiri,
    // tidak ikut melayang mengikuti padding konten.
    await page.getByRole("button", { name: "Tutup sidebar" }).click();
    await expect.poll(async () => (await kotakMain(page)).x, { timeout: 3_000 }).toBe(KONTEN_TERTUTUP);
    const setelahTutup = (await page.getByRole("button", { name: "Buka sidebar" }).boundingBox())!;
    expect(Math.round(setelahTutup.x)).toBe(12);
  });

  test("tagline Automation Tugure tampil kecil dan abu-abu di bawah Autore", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    const tagline = page.getByTestId("sidebar-brand").getByText("Automation Tugure");
    await expect(tagline).toBeVisible();

    const gaya = await tagline.evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, color: s.color };
    });
    expect(gaya.size).toBe("10px");
    // text-muted bertema (#4b5563 di light) — lolos kontras AA 4.5:1.
    expect(gaya.color).toBe("rgb(75, 85, 99)");

    // Urutan: di bawah "Autore", di atas tagline lama.
    const urutan = await page
      .getByTestId("sidebar-brand")
      .evaluate((el) => Array.from(el.querySelectorAll("p"), (p) => p.textContent));
    expect(urutan).toEqual(["Autore", "Automation Tugure", "CI/CD Workspace"]);
  });

  test.describe("prefers-reduced-motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("geseran instan: tanpa transisi, konten langsung di posisi akhir", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto("/", { waitUntil: "networkidle" });

      // transition-none mematikan transition-property (durasi utuh), jadi yang
      // menentukan "tidak beranimasi" adalah tidak adanya CSS transition aktif.
      const sifatTransisi = await page
        .locator("main")
        .evaluate((el) => getComputedStyle(el).transitionProperty);
      expect(sifatTransisi).toBe("none");

      await page.getByRole("button", { name: "Tutup sidebar" }).click();
      await expect.poll(async () => (await kotakMain(page)).x, { timeout: 1_000 }).toBe(KONTEN_TERTUTUP);
    });
  });
});
