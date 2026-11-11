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

    // Topbar ikut rapat: hamburger dan tagline mulai di tepi kiri (12px),
    // bukan menyisakan lubang 274px.
    expect(await paddingTopbar(page)).toBe(`${KONTEN_TERTUTUP}px`);

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

  test("tagline produk tampil di semua halaman, tanpa judul jalur dinamis", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    for (const rute of ["/", "/pipeline", "/applications", "/audit"]) {
      await page.goto(rute, { waitUntil: "networkidle" });
      const topbar = page.locator("header");
      await expect(topbar.getByTestId("topbar-tagline")).toBeVisible();
      await expect(topbar.getByTestId("topbar-tagline")).toHaveText("Automation Tugure");
      // Breadcrumb "Autore / <halaman>" sudah dihapus total dari topbar.
      await expect(topbar.getByText(/Autore \//)).toHaveCount(0);
    }
  });

  test("hamburger duduk di grup kiri topbar: di kanan sidebar, di kiri tagline", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/pipeline", { waitUntil: "networkidle" });

    const tombolKotak = (await page.getByRole("button", { name: "Tutup sidebar" }).boundingBox())!;
    // Di atas area konten, bukan menabrak kartu sidebar (tepi kanannya 12 + 250).
    expect(Math.round(tombolKotak.x)).toBeGreaterThanOrEqual(SIDEBAR_X + LEBAR_SIDEBAR);

    // Ikon tiga garis (Menu), bukan ikon panel.
    await expect(page.locator("header svg.lucide-menu").first()).toBeVisible();
    await expect(page.locator("header svg.lucide-panel-left")).toHaveCount(0);

    // Tagline menyusul di kanan tombol, bukan mendahuluinya.
    const taglineKotak = (await page.getByTestId("topbar-tagline").boundingBox())!;
    expect(Math.round(taglineKotak.x)).toBeGreaterThanOrEqual(
      Math.round(tombolKotak.x + tombolKotak.width),
    );

    // Saat ditutup tombol ikut meluncur ke tepi kiri bersama padding baris.
    await page.getByRole("button", { name: "Tutup sidebar" }).click();
    await expect.poll(async () => (await kotakMain(page)).x, { timeout: 3_000 }).toBe(KONTEN_TERTUTUP);
    const setelahTutup = (await page.getByRole("button", { name: "Buka sidebar" }).boundingBox())!;
    expect(Math.round(setelahTutup.x)).toBeLessThanOrEqual(24);
  });

  test("tagline duduk di topbar tepat di kanan hamburger, kepala sidebar bersih", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    const tombol = page.getByRole("button", { name: "Tutup sidebar" });
    const tagline = page.getByTestId("topbar-tagline");
    await expect(tagline).toBeVisible();
    await expect(tagline).toHaveText("Automation Tugure");

    const ukur = await tagline.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const tb = (
        document.querySelector('header button[aria-controls="sidebar-utama"]') as HTMLElement
      ).getBoundingClientRect();
      const kartu = (document.querySelector("#sidebar-utama") as HTMLElement).getBoundingClientRect();
      const gaya = getComputedStyle(el);
      const gayaSync = getComputedStyle(
        Array.from(document.querySelectorAll("header button")).find((b) =>
          b.textContent?.includes("Sync"),
        ) as HTMLElement,
      );
      return {
        tagline: {
          x: Math.round(b.x),
          y: Math.round(b.y),
          right: Math.round(b.right),
          bottom: Math.round(b.bottom),
        },
        tombol: {
          x: Math.round(tb.x),
          right: Math.round(tb.right),
          y: Math.round(tb.y),
          bottom: Math.round(tb.bottom),
        },
        kartu: { x: Math.round(kartu.x), right: Math.round(kartu.right) },
        size: gaya.fontSize,
        bobot: gaya.fontWeight,
        color: gaya.color,
        font: gaya.fontFamily,
        latar: getComputedStyle(document.querySelector("header") as HTMLElement).backgroundColor,
        terpotong: el.scrollWidth - el.clientWidth,
        sizeSync: gayaSync.fontSize,
        bobotSync: gayaSync.fontWeight,
        tetangga: el.previousElementSibling?.getAttribute("aria-label") ?? "",
      };
    });

    // 1. Duduk di KANAN tombol, tidak menumpuk, satu band 64px topbar.
    expect(ukur.tetangga, "tagline tidak langsung setelah tombol").toBe("Tutup sidebar");
    expect(ukur.tagline.x).toBeGreaterThanOrEqual(ukur.tombol.right);
    expect(ukur.tagline.y).toBeLessThan(ukur.tombol.bottom);
    expect(ukur.tagline.bottom).toBeGreaterThan(ukur.tombol.y);

    // 2. Bukan bagian kartu sidebar: seluruhnya di luar tepi kanannya.
    expect(ukur.tagline.x).toBeGreaterThan(ukur.kartu.right);

    // 3. Tipografi: 11px Google Sans Flex, utuh, kontras AA di atas latar topbar.
    expect(ukur.size).toBe("14px");
    expect(ukur.font).toMatch(/Google Sans Flex/);
    // Sama ukuran dan bobot dengan label tombol Sync di ujung kanan topbar.
    expect(ukur.sizeSync).toBe(ukur.size);
    expect(ukur.bobotSync).toBe(ukur.bobot);
    expect(ukur.terpotong).toBeLessThanOrEqual(0);

    const kanal = (c: number) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const luminansi = (rgb: number[]) =>
      0.2126 * kanal(rgb[0]) + 0.7152 * kanal(rgb[1]) + 0.0722 * kanal(rgb[2]);
    const teks = (ukur.color.match(/\d+/g) as string[]).slice(0, 3).map(Number);
    const latar = (ukur.latar.match(/\d+/g) as string[]).slice(0, 3).map(Number);
    const [terang, gelap] = [luminansi(teks), luminansi(latar)].sort((a, b) => b - a);
    expect((terang + 0.05) / (gelap + 0.05)).toBeGreaterThanOrEqual(4.5);

    // 4. Kepala sidebar tidak lagi memuat tagline.
    await expect(page.getByTestId("sidebar-brand").getByText("Automation Tugure")).toHaveCount(0);

    // 5. Tagline ikut topbar saat sidebar ditutup: tetap di kanan tombol.
    await tombol.click();
    await expect(tagline).toBeVisible();
    const saatTutup = await tagline.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const tb = (
        document.querySelector('header button[aria-controls="sidebar-utama"]') as HTMLElement
      ).getBoundingClientRect();
      return { tag: Math.round(b.x), tombolRight: Math.round(tb.right) };
    });
    expect(saatTutup.tag).toBeGreaterThanOrEqual(saatTutup.tombolRight);
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
