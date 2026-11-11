import { expect, test, type Page } from "@playwright/test";

// HP 390x844 (iPhone 12–15). Sebelum perbaikan, /security menggeser 286px dan
// tabel butuh 727–745px di layar 390px — tes ini yang menjaganya.
const HP = { width: 390, height: 844 };

const RUTE = ["/", "/applications", "/pipeline", "/security"] as const;

/**
 * Lebar dokumen vs lebar layar, plus elemen mana yang melewati tepi kanan —
 * supaya kegagalan menyebut pelakunya, bukan cuma angkanya.
 */
async function ukurLebar(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const lebar = de.clientWidth;
    const pelaku: string[] = [];

    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > lebar + 1) {
        pelaku.push(
          `${el.tagName.toLowerCase()} w=${Math.round(r.width)} kanan=${Math.round(r.right)} "${(el.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 30)}"`,
        );
      }
    }

    return { scroll: de.scrollWidth - lebar, pelaku: pelaku.slice(0, 8) };
  });
}

test.describe("Autore dashboard mobile contract @390x844", () => {
  test.use({ viewport: HP, isMobile: true, hasTouch: true });

  for (const rute of RUTE) {
    test(`nol scroll horizontal di ${rute}`, async ({ page }) => {
      await page.goto(rute, { waitUntil: "networkidle" });

      // Dua syarat: halaman tidak menggeser, DAN tidak ada elemen yang lebih
      // lebar dari layar — tabel di dalam wadah `overflow-x-auto` tidak
      // menggeser halaman, tapi tetap memaksa jempol men-swipe menyamping.
      //
      // Di-poll, bukan dibaca sekali: tepat setelah `networkidle` animasi masuk
      // masih berjalan, dan pengukuran sekali sempat menangkap frame antara
      // (4 div 215/107 px, 4 px lewat tepi) yang hilang sendiri sepersekian
      // detik kemudian. Yang dijamin kontraknya: layout akhir tidak menggeser.
      await expect
        .poll(
          async () => {
            const { scroll, pelaku } = await ukurLebar(page);
            return scroll <= 1 && pelaku.length === 0
              ? "stabil"
              : `scroll=${scroll}; pelaku: ${pelaku.join(" | ") || "tidak ada"}`;
          },
          { timeout: 5_000, message: `layout ${rute} harus stabil tanpa geser horizontal` },
        )
        .toBe("stabil");
    });
  }

  test("navigasi pindah ke bar bawah, sidebar dan strip topbar hilang", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("navigation", { name: "Navigasi bawah" })).toBeVisible();
    await expect(page.locator("aside")).toBeHidden();

    // Topbar satu baris 64px, bukan 117px seperti waktu nav masih di dalamnya.
    const tinggiTopbar = await page.locator("header").first().evaluate((el) => el.getBoundingClientRect().height);
    expect(tinggiTopbar).toBeLessThanOrEqual(72);

    // Empat tujuan, semuanya terlihat penuh (tidak ada yang terpotong di tepi).
    for (const nama of ["Dashboard", "Aplikasi", "Pipeline", "Keamanan"]) {
      await expect(page.getByRole("link", { name: nama })).toBeVisible();
    }
  });

  test("bar bawah benar-benar menavigasi, bukan cuma tampil", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Keamanan" }).click();

    await expect(page).toHaveURL(/\/security$/);
    await expect(page.getByRole("heading", { name: "Keamanan", exact: true })).toBeVisible();
  });

  test("baris terakhir konten tidak tertutup bar bawah", async ({ page }) => {
    await page.goto("/applications", { waitUntil: "networkidle" });

    // Harus di-scroll ke bawah dulu: kalau tidak, kartu terakhir memang masih
    // jauh di bawah layar dan tesnya mengukur hal yang salah.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const bawahTerakhir = await page
      .getByTestId("kartu-aplikasi")
      .last()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const atasBar = await page
      .getByRole("navigation", { name: "Navigasi bawah" })
      .evaluate((el) => el.getBoundingClientRect().top);

    // pb-24 di <main> + bar fixed: kartu terakhir selalu bisa di-scroll ke atas bar.
    expect(bawahTerakhir, "kartu terakhir harus berhenti di atas bar").toBeLessThanOrEqual(atasBar + 1);
  });

  test("daftar aplikasi jadi kartu, bukan tabel yang harus digeser", async ({ page }) => {
    await page.goto("/applications", { waitUntil: "networkidle" });

    const kartu = page.getByTestId("kartu-aplikasi");
    await expect(kartu.first()).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    // Sasaran sentuh 44px untuk tautan aksi di dalam kartu.
    const tautan = kartu.first().getByRole("link", { name: "Detail" });
    const kotak = await tautan.boundingBox();
    expect(kotak?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("halaman keamanan tidak lagi melebar gara-gara digest panjang", async ({ page }) => {
    await page.goto("/security", { waitUntil: "networkidle" });

    const kartu = page.locator("section[class*='rounded-lg']").first();
    const kotak = await kartu.boundingBox();
    expect(kotak?.width ?? 0).toBeLessThanOrEqual(HP.width);
  });
});
