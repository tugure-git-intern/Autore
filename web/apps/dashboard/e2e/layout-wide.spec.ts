import { test, expect } from "@playwright/test";

// Keluhan yang dijaga tes ini: jarak panel konten ke menu kiri ikut melebar saat
// viewport lebar / browser di-zoom out. Penyebabnya `max-w-[1440px] mx-auto` di
// <main>: sisa lebar viewport jadi latar biru di kiri & kanan panel. Sekarang
// panelnya selebar kolom, batas 1440px pindah ke pembungkus isi.
const LEBAR_LAYAR = [1920, 2560];

// 250px sidebar + 12px jarak kiri + 8px jarak kanan.
const JARAK_KIRI = 12;
const JARAK_KANAN = 8;
const SIDEBAR = 250;

test.describe("jarak panel konten di layar lebar", () => {
  for (const lebar of LEBAR_LAYAR) {
    test(`viewport ${lebar}px: jarak kiri ${JARAK_KIRI}px & kanan ${JARAK_KANAN}px, panel selebar kolom`, async ({ page }) => {
      await page.setViewportSize({ width: lebar, height: 1080 });
      await page.goto("/");

      const sidebar = (await page.locator("aside").boundingBox())!;
      expect(Math.round(sidebar.x)).toBe(0);
      expect(Math.round(sidebar.width)).toBe(SIDEBAR);

      const main = (await page.locator("main").boundingBox())!;
      expect(Math.round(main.x)).toBe(SIDEBAR + JARAK_KIRI);
      expect(Math.round(main.width)).toBe(lebar - SIDEBAR - JARAK_KIRI - JARAK_KANAN);

      // Isi tetap dibatasi 1440px dan ditengahkan di dalam panel putih.
      const isi = (await page.locator("main > div").boundingBox())!;
      expect(Math.round(isi.width)).toBe(1440);
      expect(Math.round(isi.x - main.x)).toBe(Math.round((main.width - isi.width) / 2));

      // Warna tepat di titik kritis: celah biru, panel putih, celah biru lagi.
      const warna = await page.evaluate(
        ([titikKiri, titikTengah, titikKanan]: number[]) =>
          [titikKiri, titikTengah, titikKanan].map((titik) => {
            const el = document.elementFromPoint(titik, 400);
            return el ? getComputedStyle(el).backgroundColor : "";
          }),
        [SIDEBAR + JARAK_KIRI / 2, SIDEBAR + JARAK_KIRI + 4, lebar - JARAK_KANAN / 2],
      );
      expect(warna[0]).toBe("rgb(240, 245, 254)");
      expect(warna[1]).toBe("rgb(255, 255, 255)");
      expect(warna[2]).toBe("rgb(240, 245, 254)");
    });
  }

  test("saat digulir ke bawah, bingkai <main> dan sudut rounded tidak ketiban navbar", async ({
    page,
  }) => {
    // Tinggi 500px supaya konten pasti melebihi tinggi panel dan bisa di-scroll.
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto("/audit", { waitUntil: "networkidle" });

    const hasil = await page.evaluate(() => {
      const header = document.querySelector("header")!;
      const main = document.querySelector("main")!;
      main.scrollTop = 200;
      window.scrollTo(0, 200);
      const hRect = header.getBoundingClientRect();
      const mRect = main.getBoundingClientRect();
      return {
        headerBottom: Math.round(hRect.bottom),
        mainTop: Math.round(mRect.top),
        mainScrollTop: main.scrollTop,
        windowScrollY: window.scrollY,
        overflowY: getComputedStyle(main).overflowY,
      };
    });

    expect(hasil.overflowY).toBe("auto");
    expect(hasil.mainScrollTop).toBeGreaterThan(0);
    expect(hasil.windowScrollY).toBe(0);
    // Tepi atas <main> wajib tetap di bawah <header>, tidak boleh masuk ke kolongnya.
    expect(hasil.mainTop).toBe(hasil.headerBottom);
  });
});
