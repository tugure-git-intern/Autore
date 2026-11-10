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

  test("menu Penampilan mengganti tema lewat modal kebab dan tersimpan setelah reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/", { waitUntil: "networkidle" });

    // Toggle lama sudah tidak ada; satu-satunya jalan adalah kebab > Penampilan.
    await expect(page.getByTestId("theme-toggle")).toHaveCount(0);

    // Urutan visual kiri ke kanan: Sync -> kebab -> avatar profil.
    const urutan = await page.evaluate(() => {
      const header = document.querySelector("header") as HTMLElement;
      const sync = Array.from(header.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Sync"),
      ) as HTMLElement;
      const kebab = header.querySelector('[aria-label="Menu lainnya"]') as HTMLElement;
      const kebabIkon = kebab.querySelector("svg") as SVGSVGElement;
      const avatar = (header.querySelector("summary img") ?? header.querySelector("summary span")) as HTMLElement;
      const kotak = (el: Element) => el.getBoundingClientRect();
      return {
        syncKanan: kotak(sync).right,
        syncPaddingKanan: getComputedStyle(sync).paddingRight,
        kebabKiri: kotak(kebab).left,
        kebabKanan: kotak(kebab).right,
        kebabLebar: Math.round(kotak(kebab).width),
        kebabTinggi: Math.round(kotak(kebab).height),
        kebabIkonKiri: kotak(kebabIkon).left,
        kebabIkonKanan: kotak(kebabIkon).right,
        avatarKiri: kotak(avatar).left,
      };
    });
    expect(urutan.syncKanan).toBeLessThanOrEqual(urutan.kebabKiri);
    expect(urutan.kebabKanan).toBeLessThanOrEqual(urutan.avatarKiri);
    // Rapat ala Cloud Console: kotak tombol kebab menempel pill (0px), dan jarak
    // ke tinta ikon 8px di kiri-kanan. Target sentuh tetap 32x44 (di atas minimum
    // WCAG 2.5.8 24x24), jadi rapat tanpa mengorbankan akurasi klik.
    expect(Math.round(urutan.kebabKiri - urutan.syncKanan)).toBe(0);
    expect(Math.round(urutan.kebabIkonKiri - urutan.syncKanan)).toBe(8);
    expect(Math.round(urutan.avatarKiri - urutan.kebabIkonKanan)).toBe(8);
    expect(urutan.kebabLebar).toBe(32);
    expect(urutan.kebabTinggi).toBe(44);
    expect(urutan.syncPaddingKanan).toBe("12px");

    const bukaModal = async () => {
      await page.getByRole("button", { name: "Menu lainnya" }).click();
      await page.getByRole("menuitem", { name: /Penampilan/ }).click();
      return page.getByRole("dialog");
    };

    let modal = await bukaModal();
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("heading", { name: "Pilih Tema Tampilan" })).toBeVisible();
    const gayaModal = await modal.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        color: s.color,
        radius: s.borderRadius,
        lebar: el.getBoundingClientRect().width,
      };
    });
    expect(gayaModal.bg).toBe("rgb(60, 68, 78)");
    expect(gayaModal.color).toBe("rgb(255, 255, 255)");
    expect(Number.parseFloat(gayaModal.radius)).toBeGreaterThanOrEqual(12);
    expect(gayaModal.lebar).toBeGreaterThanOrEqual(520);

    // Tiga kartu radio sejajar + miniatur UI di tiap kartu.
    await expect(modal.getByRole("radio", { name: "Terang" })).toBeVisible();
    await expect(modal.getByRole("radio", { name: "Gelap" })).toBeVisible();
    await expect(modal.getByRole("radio", { name: "Ikuti Sistem" })).toBeVisible();
    await expect(modal.getByTestId("preview-light")).toBeVisible();
    await expect(modal.getByTestId("preview-dark")).toBeVisible();
    await expect(modal.getByTestId("preview-system")).toBeVisible();

    // Sakelar Kontras Tinggi beserta subteks.
    await expect(
      modal.getByText("Meningkatkan kontras antara teks dan latar belakang."),
    ).toBeVisible();
    const sakelar = modal.getByRole("switch", { name: /Kontras Tinggi/ });
    await expect(sakelar).toHaveAttribute("aria-checked", "false");
    await sakelar.click();
    await expect(sakelar).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveClass(/high-contrast/);
    await sakelar.click();
    await expect(sakelar).toHaveAttribute("aria-checked", "false");

    // Escape menutup modal (dialog native).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    modal = await bukaModal();
    await modal.getByRole("radio", { name: "Gelap" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    const stored = await page.evaluate(() => window.localStorage.getItem("autore-theme"));
    expect(stored).toBe("dark");

    // Kartu aktif ditandai border biru dan aria-checked.
    const kartuGelap = modal.getByRole("radio", { name: "Gelap" });
    expect(await kartuGelap.getAttribute("aria-checked")).toBe("true");
    const gayaKartu = await kartuGelap.evaluate((el) => {
      const s = getComputedStyle(el);
      return { warna: s.borderTopColor, lebar: s.borderTopWidth };
    });
    expect(gayaKartu.lebar).toBe("2px");
    const warnaTerang = await modal
      .getByRole("radio", { name: "Terang" })
      .evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(gayaKartu.warna).not.toBe(warnaTerang);
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

    // Klik di luar panel (tepi dialog) menutup modal tanpa mengubah tema.
    const modalLagi = await bukaModal();
    const kotak = await modalLagi.boundingBox();
    if (kotak) await page.mouse.click(4, 4);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("html")).toHaveClass(/dark/);

    for (const rute of ["/applications", "/audit", "/pipeline", "/security", "/login"]) {
      await page.goto(rute, { waitUntil: "networkidle" });
      const putih = await page.evaluate(() => {
        const kandidat = Array.from(
          document.querySelectorAll(
            "[data-testid='page-tab-header'], thead, main, main section, table",
          ),
        ) as HTMLElement[];
        return kandidat
          .map((el) => getComputedStyle(el).backgroundColor)
          .filter((bg) => bg === "rgb(255, 255, 255)");
      });
      expect(putih, `masih ada elemen putih nyala di ${rute}`).toEqual([]);
    }
  });

  test("scrollbar global tipis 8px, track transparan, thumb abu terang/gelap", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "networkidle" });

    // Scrollbar overlay di Chromium headless tidak memakan lebar kotak, jadi lebar
    // 8px diverifikasi dari aturan ::-webkit-scrollbar yang benar-benar diparse
    // browser, bukan dari offsetWidth.
    const ukur = async () =>
      page.evaluate(() => {
        const thumb: { sel: string; bg: string; radius: string }[] = [];
        const track: { sel: string; bg: string }[] = [];
        let lebarPseudo = "";
        let adaFallbackFirefox = false;

        // Aturan bisa terkubur di @layer/@supports, jadi turun rekursif.
        const jelajah = (rules: CSSRuleList) => {
          for (const rule of Array.from(rules)) {
            const r = rule as CSSStyleRule & { cssRules?: CSSRuleList };
            if (r.selectorText?.includes("::-webkit-scrollbar")) {
              const sel = r.selectorText;
              if (/::-webkit-scrollbar$/.test(sel)) lebarPseudo = r.style.width;
              if (sel.includes("::-webkit-scrollbar-thumb")) {
                thumb.push({ sel, bg: r.style.backgroundColor, radius: r.style.borderRadius });
              }
              if (sel.includes("::-webkit-scrollbar-track")) {
                track.push({ sel, bg: r.style.backgroundColor });
              }
            }
            if (r.cssRules) jelajah(r.cssRules);
          }
        };

        for (const sheet of Array.from(document.styleSheets)) {
          let rules: CSSRuleList;
          let teks = "";
          try {
            rules = sheet.cssRules;
            teks = Array.from(rules).map((r) => r.cssText).join("");
          } catch {
            continue;
          }
          if (teks.includes("scrollbar-width: thin")) adaFallbackFirefox = true;
          jelajah(rules);
        }
        return { lebarPseudo, adaFallbackFirefox, thumb, track };
      });

    const terang = await ukur();
    expect(terang.lebarPseudo).toBe("8px");
    expect(terang.adaFallbackFirefox).toBe(true);
    expect(terang.thumb.find((t) => !t.sel.includes(".dark"))?.bg).toBe("rgb(204, 204, 204)");
    expect(terang.thumb.find((t) => !t.sel.includes(".dark"))?.radius).not.toBe("");
    expect(terang.track.every((t) => t.bg === "transparent" || t.bg === "rgba(0, 0, 0, 0)")).toBe(true);

    await page.evaluate(() => window.localStorage.setItem("autore-theme", "dark"));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveClass(/dark/);

    const gelap = await ukur();
    expect(gelap.lebarPseudo).toBe("8px");
    expect(gelap.adaFallbackFirefox).toBe(true);
    expect(gelap.thumb.find((t) => t.sel.includes(".dark"))?.bg).toBe("rgb(90, 98, 112)");
    expect(gelap.track.every((t) => t.bg === "transparent" || t.bg === "rgba(0, 0, 0, 0)")).toBe(true);
  });

  test("tombol Sync berbentuk kapsul: rounded-full, border #50638b, latar transparan", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const sync = page.getByRole("button", { name: "Sync" });
    await expect(sync).toBeVisible();

    const gaya = await sync.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        radius: s.borderRadius,
        padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
        borderWidth: s.borderTopWidth,
        borderColor: s.borderTopColor,
        bg: s.backgroundColor,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
      };
    });

    // Chromium membesarkan radius pill sampai batas float, jadi cukup cek >= 9999.
    expect(Number.parseFloat(gaya.radius)).toBeGreaterThanOrEqual(9999);
    expect(gaya.padding).toBe("6px 12px 6px 12px");
    expect(gaya.borderWidth).toBe("1px");
    expect(gaya.borderColor).toBe("rgb(80, 99, 139)");
    expect(gaya.bg).toBe("rgba(0, 0, 0, 0)");
    expect(gaya.fontSize).toBe("14px");
    expect(gaya.fontWeight).toBe("500");

    // Tailwind v4 mencampur warna lewat oklab, jadi hasilnya bukan string rgb();
    // yang penting latar hover benar-benar berubah dari transparan.
    await sync.hover();
    const bgHover = await sync.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgHover).not.toBe(gaya.bg);
    expect(bgHover).not.toContain("/ 0)");
  });

  test("font utama menggunakan Google Sans Flex via --font-google-sans-flex", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const fontInfo = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      return {
        bodyFont: s.fontFamily,
        varGoogleSans: root.getPropertyValue("--font-google-sans-flex").trim(),
      };
    });
    expect(fontInfo.varGoogleSans).toContain("Google Sans Flex");
    expect(fontInfo.bodyFont.toLowerCase()).toContain("google sans flex");
    expect(fontInfo.bodyFont.toLowerCase()).not.toContain("inter");
  });

  test("navigasi sidebar di Dark Mode bebas FOUC: html dan body tetap berlatar gelap tanpa reload dokumen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.setItem("autore-theme", "dark");
      document.documentElement.classList.add("dark");
    });

    const bgAwal = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    }));
    expect(bgAwal.html).toBe("rgb(53, 59, 67)");
    expect(bgAwal.body).toBe("rgb(53, 59, 67)");

    await page.evaluate(() => {
      (window as unknown as { __spa_marker?: string }).__spa_marker = "AUTORE_STILL_ALIVE";
    });

    const linkAplikasi = page.locator("aside").getByRole("link", { name: "Daftar Aplikasi" });
    await linkAplikasi.click();
    await page.waitForURL("**/applications");

    const marker = await page.evaluate(
      () => (window as unknown as { __spa_marker?: string }).__spa_marker,
    );
    expect(marker).toBe("AUTORE_STILL_ALIVE");

    const bgSetelah = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    }));
    expect(bgSetelah.html).toBe("rgb(53, 59, 67)");
    expect(bgSetelah.body).toBe("rgb(53, 59, 67)");

    // Jelajah menu lain di sidebar: background body tidak boleh berkedip putih
    for (const [nama, ruteTarget] of [
      ["Pipeline & Log", "/pipeline"],
      ["Keamanan", "/security"],
      ["Audit Log", "/audit"],
      ["Dashboard", "/"],
    ] as const) {
      await page.locator("aside").getByRole("link", { name: nama }).click();
      await page.waitForURL(`**${ruteTarget}`);
      const bg = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        html: getComputedStyle(document.documentElement).backgroundColor,
      }));
      expect(bg.body).toBe("rgb(53, 59, 67)");
      expect(bg.html).toBe("rgb(53, 59, 67)");
    }
  });

  test("hard refresh di Dark Mode bebas FOUC via critical inline CSS di head", async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      localStorage.setItem("autore-theme", "dark");
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // 1. Critical inline style harus ada di head dengan aturan html.dark
    const inlineStyle = await page.evaluate(() => {
      const el = document.querySelector("head style");
      return el ? el.textContent : "";
    });
    expect(inlineStyle).toContain("html.dark");
    expect(inlineStyle).toContain("#353b43");
    expect(inlineStyle).toContain("color-scheme: dark");

    // 2. documentElement harus sudah berlatar #353b43 (bukan putih rgb(255, 255, 255))
    const bgHtml = await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    expect(bgHtml).toBe("rgb(53, 59, 67)");
    expect(bgHtml).not.toBe("rgb(255, 255, 255)");
  });

  test("hard refresh dengan cookie autore-theme=dark menghasilkan HTML awal yang sudah gelap (bebas FOUC tanpa JS)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: "e2e/.auth/state.json",
      javaScriptEnabled: false,
    });
    await ctx.addCookies([
      {
        name: "autore-theme",
        value: "dark",
        domain: "100.80.3.14",
        path: "/",
      },
    ]);
    const page = await ctx.newPage();
    await page.goto("/login");

    const htmlState = await page.evaluate(() => ({
      className: document.documentElement.className,
      bg: getComputedStyle(document.documentElement).backgroundColor,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    }));

    expect(htmlState.className).toContain("dark");
    expect(htmlState.bg).toBe("rgb(53, 59, 67)");
    expect(htmlState.colorScheme).toBe("dark");

    await ctx.close();
  });

  test("hard refresh di Dark Mode bebas FOUC via critical inline CSS dan cookie SSR", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "autore-theme",
        value: "dark",
        domain: "100.80.3.14",
        path: "/",
      },
    ]);
    await context.addInitScript(() => {
      localStorage.setItem("autore-theme", "dark");
    });

    await page.goto("/", { waitUntil: "commit" });

    const statusAwal = await page.evaluate(() => {
      const el = document.documentElement;
      return {
        hasDarkClass: el.classList.contains("dark"),
        bg: getComputedStyle(el).backgroundColor,
        colorScheme: getComputedStyle(el).colorScheme,
      };
    });

    expect(statusAwal.hasDarkClass).toBe(true);
    expect(statusAwal.bg).toBe("rgb(53, 59, 67)");
    expect(statusAwal.colorScheme).toBe("dark");

    await page.reload({ waitUntil: "domcontentloaded" });
    const statusReload = await page.evaluate(() => ({
      hasDarkClass: document.documentElement.classList.contains("dark"),
      bg: getComputedStyle(document.documentElement).backgroundColor,
    }));
    expect(statusReload.hasDarkClass).toBe(true);
    expect(statusReload.bg).toBe("rgb(53, 59, 67)");
  });
});
