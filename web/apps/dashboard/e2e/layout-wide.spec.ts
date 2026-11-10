import { test, expect } from "@playwright/test";

// Keluhan yang dijaga tes ini: sidebar melayang (fixed) sementara topbar
// membentang ujung-ke-ujung tanpa terputus. Karena sidebar keluar dari alur flex,
// kolom konten mengisi lebar viewport penuh dan topbar benar-benar w-full.
const LEBAR_LAYAR = [1920, 2560];

// Kartu sidebar: renggang 12px dari tepi kiri/atas/bawah, lebar 250px.
const SIDEBAR_X = 12;
const SIDEBAR = 250;
// Kartu konten mulai setelah sidebar + jarak 12px, dan renggang 12px dari kanan.
const KONTEN_X = SIDEBAR_X + SIDEBAR + 12;
const JARAK_KANAN = 12;
const TINGGI_TOPBAR = 64;

test.describe("kerangka melayang di layar lebar", () => {
  test("topbar membentang ujung ke ujung dan tidak pernah tertutup sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    // getByRole("banner"): kartu konten juga memakai <header>, tapi hanya topbar
    // di level kerangka yang jadi banner landmark.
    const header = (await page.getByRole("banner").boundingBox())!;
    expect(Math.round(header.x)).toBe(0);
    expect(Math.round(header.width)).toBe(1280);

    // Di 12px teratas viewport, tidak boleh ada satu titik pun yang dipegang
    // selain topbar: di situlah "putus" itu dulu terlihat.
    const tumpang = await page.evaluate(() => {
      const topbar = document.querySelector("header")!;
      return [4, 60, 130, 200, 260, 300, 700, 1276]
        .map((x) => {
          const el = document.elementFromPoint(x, 6);
          if (!el) return `x=${x}: kosong`;
          if (el === topbar || topbar.contains(el)) return null;
          const kelas = typeof el.className === "string" ? el.className.trim() : "";
          return `x=${x}: ${el.tagName.toLowerCase()}.${kelas}`;
        })
        .filter((v): v is string => v !== null);
    });
    expect(tumpang, `elemen di atas topbar: ${tumpang.join(" | ")}`).toEqual([]);
  });

  for (const lebar of LEBAR_LAYAR) {
    test(`viewport ${lebar}px: sidebar melayang 12px dari tepi, kartu konten selebar sisa kolom`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: lebar, height: 1080 });
      await page.goto("/");

      const sidebar = (await page.locator("aside").boundingBox())!;
      expect(Math.round(sidebar.x)).toBe(SIDEBAR_X);
      expect(Math.round(sidebar.y)).toBe(12);
      expect(Math.round(sidebar.width)).toBe(SIDEBAR);
      expect(Math.round(sidebar.height)).toBe(1080 - 24);

      // Sidebar menyatu dengan chrome: warna sama dengan latar utama dan tanpa border.
      const gayaSidebar = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector("aside")!);
        return {
          latar: cs.backgroundColor,
          borderAtas: cs.borderTopWidth,
          borderKanan: cs.borderRightWidth,
          bayangan: cs.boxShadow,
        };
      });
      expect(gayaSidebar.latar).toBe("rgb(240, 245, 254)");
      expect(gayaSidebar.borderAtas).toBe("0px");
      expect(gayaSidebar.borderKanan).toBe("0px");
      // Tanpa bayangan: gradasi 1px di tepi kanan terbaca sebagai sekat vertikal.
      expect(gayaSidebar.bayangan).toBe("none");

      // Sisi kiri kartu konten juga polos: biru chrome bertemu putih langsung,
      // tanpa garis pemisah yang bikin tampilan terlihat terpotong.
      const tepiKonten = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector("main")!);
        return {
          kiri: cs.borderLeftWidth,
          atas: cs.borderTopWidth,
          kanan: cs.borderRightWidth,
        };
      });
      expect(tepiKonten.kiri).toBe("0px");
      expect(tepiKonten.atas).toBe("1px");
      expect(tepiKonten.kanan).toBe("1px");

      const main = (await page.locator("main").boundingBox())!;
      expect(Math.round(main.x)).toBe(KONTEN_X);
      expect(Math.round(main.y)).toBe(TINGGI_TOPBAR + 12);
      expect(Math.round(main.width)).toBe(lebar - KONTEN_X - JARAK_KANAN);
      expect(Math.round(main.height)).toBe(1080 - TINGGI_TOPBAR - 12 - JARAK_KANAN);

      // Isi tetap dibatasi 1440px dan ditengahkan di dalam kartu putih.
      const isi = (await page.locator("main > div").boundingBox())!;
      expect(Math.round(isi.width)).toBe(1440);
      expect(Math.round(isi.x - main.x)).toBe(Math.round((main.width - isi.width) / 2));

      // Warna tepat di titik kritis: celah biru, kartu putih, celah biru lagi.
      const warna = await page.evaluate(
        ([titikKiri, titikTengah, titikKanan]: number[]) =>
          [titikKiri, titikTengah, titikKanan].map((titik) => {
            const el = document.elementFromPoint(titik, 400);
            return el ? getComputedStyle(el).backgroundColor : "";
          }),
        [SIDEBAR_X + SIDEBAR + 6, KONTEN_X + 6, lebar - JARAK_KANAN / 2],
      );
      expect(warna[0]).toBe("rgb(240, 245, 254)");
      expect(warna[1]).toBe("rgb(255, 255, 255)");
      expect(warna[2]).toBe("rgb(240, 245, 254)");
    });
  }

  test("saat digulir ke bawah, kartu konten tidak ketiban topbar", async ({ page }) => {
    // Tinggi 500px supaya konten pasti melebihi tinggi kartu dan bisa di-scroll.
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
    // Tepi atas kartu konten tetap renggang 12px di bawah topbar.
    expect(hasil.mainTop).toBe(hasil.headerBottom + 12);
  });

  test("tombol ThemeToggle mengubah ke Dark Mode (#282c32, #353b43, #ffffff, #50638b) dan bertahan saat reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/", { waitUntil: "networkidle" });

    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(page.locator("html")).toHaveClass(/dark/);
    const stored = await page.evaluate(() => window.localStorage.getItem("autore-theme"));
    expect(stored).toBe("dark");

    const warnaDark = await page.evaluate(() => {
      const aside = document.querySelector("aside") as HTMLElement;
      const header = document.querySelector("header") as HTMLElement;
      const main = document.querySelector("main") as HTMLElement;
      const h1 = document.querySelector("h1") as HTMLElement;
      return {
        sidebarBg: getComputedStyle(aside).backgroundColor,
        navbarBg: getComputedStyle(header).backgroundColor,
        mainBg: getComputedStyle(main).backgroundColor,
        mainBorder: getComputedStyle(main).borderTopColor,
        h1Color: getComputedStyle(h1).color,
      };
    });

    expect(warnaDark.sidebarBg).toBe("rgb(40, 44, 50)");
    expect(warnaDark.navbarBg).toBe("rgb(40, 44, 50)");
    expect(warnaDark.mainBg).toBe("rgb(53, 59, 67)");
    expect(warnaDark.mainBorder).toBe("rgb(80, 99, 139)");
    expect(warnaDark.h1Color).toBe("rgb(255, 255, 255)");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
