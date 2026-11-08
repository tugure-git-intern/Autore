import { test, expect } from "@playwright/test";

// Keluhan yang dijaga tes ini: jarak panel konten ke menu kiri ikut melebar saat
// viewport lebar / browser di-zoom out. Penyebabnya `max-w-[1440px] mx-auto` di
// <main>: sisa lebar viewport jadi latar biru di kiri & kanan panel. Sekarang
// panelnya selebar kolom, batas 1440px pindah ke pembungkus isi.
const LEBAR_LAYAR = [1920, 2560];

// 250px sidebar + 8px jarak kiri + 8px jarak kanan.
const JARAK = 8;
const SIDEBAR = 250;

test.describe("jarak panel konten di layar lebar", () => {
  for (const lebar of LEBAR_LAYAR) {
    test(`viewport ${lebar}px: jarak kiri & kanan tetap ${JARAK}px, panel selebar kolom`, async ({ page }) => {
      await page.setViewportSize({ width: lebar, height: 1080 });
      await page.goto("/");

      const sidebar = (await page.locator("aside").boundingBox())!;
      expect(Math.round(sidebar.x)).toBe(0);
      expect(Math.round(sidebar.width)).toBe(SIDEBAR);

      const main = (await page.locator("main").boundingBox())!;
      expect(Math.round(main.x)).toBe(SIDEBAR + JARAK);
      expect(Math.round(main.width)).toBe(lebar - SIDEBAR - JARAK * 2);

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
        [SIDEBAR + JARAK / 2, SIDEBAR + JARAK * 4, lebar - JARAK / 2],
      );
      expect(warna[0]).toBe("rgb(240, 245, 254)");
      expect(warna[1]).toBe("rgb(255, 255, 255)");
      expect(warna[2]).toBe("rgb(240, 245, 254)");
    });
  }
});
