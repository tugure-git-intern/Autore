import { expect, test } from "@playwright/test";
import path from "node:path";

// npm runs workspace scripts with cwd = web/apps/dashboard, so this lands in
// web/apps/dashboard/e2e/__screenshots__/ (gitignored). Not golden tests: a
// human eyeballs these; no pixel diff is frozen.
const screenshotsDir = path.join(process.cwd(), "e2e", "__screenshots__");
const shot = (name: string) => path.join(screenshotsDir, `${name}.png`);

// Butuh sesi: `use.storageState` di playwright.config.ts memasang cookie
// `authjs.session-token` yang sah (lihat e2e/global-setup.ts).
const ROUTES = [
  { path: "/", file: "dashboard" },
  { path: "/applications", file: "applications" },
  { path: "/pipeline", file: "pipeline" },
  { path: "/security", file: "security" },
] as const;

// Publik: harus bisa dibuka tanpa sesi.
const ROUTES_PUBLIK = [
  { path: "/login", file: "login" },
  { path: "/403", file: "403" },
] as const;

test.describe("Autore dashboard visual contract @1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("page heading is visible and nothing overflows 1280px wide", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, "documentElement.scrollWidth").toBeLessThanOrEqual(1280);
  });

  test("sesi dari storageState benar-benar terbaca", async ({ page }) => {
    await page.goto("/");
    // UserMenu hanya dirender kalau `currentUser()` mengembalikan login (lihat
    // navbar.tsx:83). Jadi assert ini membuktikan cookie e2e diterima server,
    // bukan sekadar tidak error.
    await page.locator("header summary").click();
    await expect(page.getByText("@alif")).toBeVisible();
    await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
  });

  test("sidebar exposes five destinations including Keamanan and Audit Log", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator('aside nav[aria-label="Navigasi utama"]');
    await expect(sidebar).toBeVisible();
    // Sidebar copy is Indonesian (Ringkasan/Aplikasi/Pipeline/Keamanan); assert
    // by route so the destinations stay pinned to the real hrefs even if the
    // wording changes.
    for (const href of ["/", "/applications", "/pipeline", "/security", "/audit"]) {
      await expect(sidebar.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await expect(sidebar.locator("a")).toHaveCount(5);
  });

  test("no gradient backgrounds and no shadow heavier than box-shadow-sm", async ({ page }) => {
    await page.goto("/");
    const { gradients, heavyShadows } = await page.evaluate(() => {
      const describe = (el: Element) => {
        const id = el.id ? `#${el.id}` : "";
        const cls =
          typeof el.className === "string" && el.className
            ? `.${el.className.trim().split(/\s+/).join(".")}`
            : "";
        return `${el.tagName.toLowerCase()}${id}${cls}`;
      };
      // Tailwind menyisipkan layer `rgba(0,0,0,0)` (placeholder ring) di depan
      // setiap box-shadow; lapisan transparan itu bukan elevasi. Ambang 3px =
      // blur `shadow-sm` di Tailwind v4 (0 1px 3px); di atas itu elevasi lebih
      // berat (shadow-md ke atas) dan berarti desainnya menyimpang.
      //
      // Pengecualian: `<aside>` kerangka aplikasi memang mengambang, jadi
      // bayangannya boleh menyebar sampai 24px supaya batas panel terbaca lembut & tegas.
      // Karena panel menempel tepi kiri/atas/bawah viewport, hanya sisi kanannya
      // yang terlihat. Semua elemen lain tetap dibatasi 3px.
      const isAtMostShadowSm = (value: string, el: Element) => {
        const maks = el.tagName === "ASIDE" ? 24 : 3;
        const layers = value.split(/,(?![^(]*\))/);
        return layers
          .filter((layer) => !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(layer))
          .every((layer) => {
            const px = layer.match(/-?\d+(?:\.\d+)?px/g) ?? [];
            return px[2] === undefined || parseFloat(px[2]) <= maks;
          });
      };
      const gradients: string[] = [];
      const heavyShadows: string[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const style = getComputedStyle(el);
        if (/gradient\(/i.test(style.backgroundImage)) gradients.push(describe(el));
        const shadow = style.boxShadow;
        if (shadow && shadow !== "none" && !isAtMostShadowSm(shadow, el)) {
          heavyShadows.push(`${describe(el)} => ${shadow}`);
        }
      }
      return { gradients, heavyShadows };
    });
    expect(gradients, `gradient backgrounds: ${gradients.join(", ")}`).toEqual([]);
    expect(heavyShadows, `heavy shadows: ${heavyShadows.join(", ")}`).toEqual([]);
  });

  for (const route of ROUTES) {
    test(`captures ${route.path} at 1280x720`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.locator("body")).toBeVisible();
      await page.screenshot({ path: shot(route.file), fullPage: false });
    });
  }
});

// Tanpa sesi sama sekali: konteks baru, bukan sekadar menghapus cookie di
// konteks yang sudah punya storageState.
test.describe("tanpa sesi", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of ["/", "/applications", "/pipeline", "/security"]) {
    test(`${route} dialihkan ke /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    });
  }

  test("halaman /login tetap publik dan menawarkan login GitHub", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /github/i })).toBeVisible();
  });

  test("POST /api/actions/deploy dijawab 401, bukan dijalankan", async ({ request }) => {
    const response = await request.post("/api/actions/deploy", { data: { app: "tes-web" } });

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, status: 401 });
  });

  test("GET /api/status tetap terbuka (hanya baca)", async ({ request }) => {
    const response = await request.get("/api/status");

    expect(response.status()).toBe(200);
  });
});

test.describe("halaman publik @1280x720", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 720 } });

  for (const route of ROUTES_PUBLIK) {
    test(`captures ${route.path} at 1280x720`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.locator("body")).toBeVisible();
      await page.screenshot({ path: shot(route.file), fullPage: false });
    });
  }
});

// Data live Jenkins berubah-ubah, jadi kasus yang harus deterministik dikunci
// dengan `page.route`. Satu tes tetap memakai data nyata untuk membuktikan dua
// panggilan Jenkins memang tersambung sampai ke kartu.
test.describe("section Active Pipelines", () => {
  const pipeline = (over: Partial<Record<string, unknown>> = {}) => ({
    app: "tes-web",
    number: 42,
    status: "running",
    branch: "main",
    commit_sha: "3878d9307475eb84316edde4e77f63fd0b98ae4e",
    author: "Alif Fadlan <alif@example.test>",
    started_at: "2026-11-05T03:23:08Z",
    url: "http://100.80.3.14:8080/job/tes-web/42",
    ...over,
  });

  const paksaActive = (
    page: import("@playwright/test").Page,
    active: unknown[],
    counts: { running: number; queued: number },
  ) =>
    page.route("**/api/active", (route) =>
      route.fulfill({
        json: { data: { generated_at: "2026-11-05T03:40:00Z", active, counts }, stale: false },
      }),
    );

  test("berada di atas grafik Tren 7 Hari", async ({ page }) => {
    await page.goto("/");

    const judul = page.getByRole("heading", { name: "Active Pipelines" });
    await expect(judul).toBeVisible();

    const kotakJudul = (await judul.boundingBox())!;
    const kotakGrafik = (await page.getByRole("heading", { name: "Tren 7 Hari" }).boundingBox())!;
    expect(kotakJudul.y).toBeLessThan(kotakGrafik.y);
  });

  test("dengan data nyata: hitungan sama dengan jumlah kartu", async ({ page }) => {
    await page.goto("/");

    const hitungan = page.getByText(/\d+ berjalan atau menunggu/);
    await expect(hitungan).toBeVisible();

    const jumlah = Number((await hitungan.textContent())!.match(/^(\d+)/)![1]);
    await expect(page.getByTestId("pipeline-card")).toHaveCount(jumlah);
  });

  test("dua pipeline: satu Berjalan dengan bar, satu Menunggu tanpa bar", async ({ page }) => {
    await paksaActive(
      page,
      [pipeline(), pipeline({ app: "diag-ws", number: 0, status: "queued", branch: "" })],
      { running: 1, queued: 1 },
    );

    await page.goto("/");

    await expect(page.getByText("2 berjalan atau menunggu")).toBeVisible();
    const kartu = page.getByTestId("pipeline-card");
    await expect(kartu).toHaveCount(2);

    const berjalan = kartu.filter({ hasText: "Berjalan" });
    const menunggu = kartu.filter({ hasText: "Menunggu" });
    await expect(berjalan).toHaveCount(1);
    await expect(menunggu).toHaveCount(1);
    await expect(berjalan.getByTestId("progress-indeterminate")).toHaveCount(1);
    await expect(menunggu.getByTestId("progress-indeterminate")).toHaveCount(0);
    // Nomor build hanya ditampilkan kalau Jenkins sudah punya nomor.
    await expect(menunggu.getByText("#")).toHaveCount(0);
  });

  test("bar kemajuan benar-benar bergerak dan mengulang siklusnya", async ({ page }) => {
    await paksaActive(page, [pipeline()], { running: 1, queued: 0 });

    await page.goto("/");

    const bar = page.getByTestId("progress-indeterminate");
    const depan = page.getByTestId("progress-band-depan");
    await expect(bar).toBeVisible();

    // Komet = satu pembungkus rigid yang berisi kepala + ekor, jadi tepat satu animasi.
    // Animasinya ada di anak (bukan di elemen track), jadi wajib `subtree: true` — tanpa itu
    // hasilnya nol dan asersinya jadi bohong. Tanpa `@keyframes geser` di globals.css
    // animasinya tidak pernah dibuat browser sehingga daftarnya kosong walau kelasnya ada.
    expect(await bar.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(1);

    const posisi = () => depan.evaluate((el) => el.getBoundingClientRect().x);

    // Sampel ~2,2 detik (lebih dari satu putaran 1,6 s): kalau animasinya benar-benar
    // mengulang tanpa henti, ada satu saat posisinya melompat balik ke kiri (wrap).
    const jejak: number[] = [];
    for (let i = 0; i < 22; i++) {
      jejak.push(await posisi());
      await page.waitForTimeout(100);
    }

    // Bukti bergerak: rentang posisi jauh lebih lebar dari lebar pita sendiri.
    expect(Math.max(...jejak) - Math.min(...jejak)).toBeGreaterThan(50);
    // Bukti berulang: satu lompatan balik ke kiri = satu putaran selesai, lalu lanjut lagi.
    expect(jejak.findIndex((pos, i) => i > 0 && pos < jejak[i - 1] - 50)).toBeGreaterThan(-1);

    // Ekor menempel tanpa celah di belakang kepala, dan tetap menempel di fase mana pun —
    // inilah yang gagal waktu fasanya diatur `animation-delay`: begitu pita ekor wrap lebih
    // dulu, pasangan itu pecah. Diukur di dua fase berbeda.
    const sambungan = () =>
      page.evaluate(() => {
        const kepala = document.querySelector('[data-testid="progress-band-depan"]') as HTMLElement;
        const ekor = document.querySelector('[data-testid="progress-band-belakang"]') as HTMLElement;
        return {
          celah: kepala.getBoundingClientRect().x - ekor.getBoundingClientRect().right,
          lebarEkor: ekor.getBoundingClientRect().width,
        };
      });
    for (let i = 0; i < 2; i++) {
      const { celah, lebarEkor } = await sambungan();
      expect(Math.abs(celah), "celah antara ekor dan kepala").toBeLessThanOrEqual(2);
      expect(lebarEkor).toBeGreaterThan(20);
      await page.waitForTimeout(400);
    }
  });

  test("prefers-reduced-motion: bar berhenti bergerak tapi tetap selebar kartu", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await paksaActive(page, [pipeline()], { running: 1, queued: 0 });

    await page.goto("/");

    const bar = page.getByTestId("progress-indeterminate");
    await expect(bar).toBeVisible();
    // Tidak ada animasi sama sekali (termasuk di pita): pita disembunyikan, tapinya jadi
    // bar solid. Pasangannya: tes gerak di atas menghitung 2 di build yang sama — hanya
    // media emulation yang beda, jadi 0 di sini bukan asersi kosong.
    expect(await bar.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    await expect(page.getByTestId("progress-band-depan")).toBeHidden();

    const ukur = await bar.evaluate((el) => {
      const kartu = el.closest('[data-testid="pipeline-card"]') as HTMLElement;
      return { bar: el.getBoundingClientRect().width, kartu: kartu.getBoundingClientRect().width };
    });
    // Masih terbaca sebagai bar yang memenuhi lebar kartu, bukan kotak kecil di kiri.
    expect(ukur.bar).toBeGreaterThan(ukur.kartu * 0.8);
  });

  test("kosong: section tetap tampil dengan teks Semua pipeline selesai", async ({ page }) => {
    await paksaActive(page, [], { running: 0, queued: 0 });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Active Pipelines" })).toBeVisible();
    await expect(page.getByText("0 berjalan atau menunggu")).toBeVisible();
    await expect(page.getByText("Semua pipeline selesai")).toBeVisible();
    await expect(page.getByTestId("pipeline-card")).toHaveCount(0);
  });
});

test.describe("kartu Repository Health", () => {
  type Health = { score_percent: number; total_repos: number; gold: number; silver: number; bronze: number };

  const paksaStatus = (
    page: import("@playwright/test").Page,
    health: Health,
  ) =>
    page.route("**/api/status", (route) =>
      route.fulfill({
        json: {
          data: {
            system_status: "idle",
            infra: { jenkins: "active", nexus: "active" },
            stats: { total_apps: health.total_repos, running_containers: 2 },
            repository_health: health,
            applications: [
              {
                id: "tes-web",
                name: "tes-web",
                status: "passed",
                last_build: "2026-11-05T06:02:40Z",
                commit_sha: "feff447",
                security_issues: 0,
                deployed: true,
              },
            ],
            latest_pipeline: {
              status: "idle",
              failure_reason: "",
              stages: [],
              security_summary: "",
              commit_sha: "",
              author: "",
              raw_log: [],
            },
          },
          stale: false,
        },
      }),
    );

  test("kartu ke-5 tampil paling kanan, sebaris dengan Status Pipeline", async ({ page }) => {
    await paksaStatus(page, { score_percent: 10, total_repos: 10, gold: 1, silver: 0, bronze: 9 });
    await page.goto("/");

    const statistik = page.locator('section[aria-label="Statistik"]');
    await expect(statistik.locator("> *")).toHaveCount(5);
    await expect(statistik.getByText("Repository Health", { exact: true })).toBeVisible();
    await expect(statistik.getByText("10%", { exact: true })).toBeVisible();
    await expect(statistik.getByText("10 repos · 1 gold · 0 silver · 9 bronze")).toBeVisible();

    const judul = (await statistik.getByText("Repository Health", { exact: true }).boundingBox())!;
    const tetangga = (await statistik.getByText("Status Pipeline", { exact: true }).boundingBox())!;
    expect(judul.x).toBeGreaterThan(tetangga.x);
    // Sebaris, bukan turun ke baris kedua: grid 5 kolom di 1280px.
    expect(Math.abs(judul.y - tetangga.y)).toBeLessThan(8);
    expect(judul.x + judul.width).toBeLessThanOrEqual(1280);
  });

  test("ikon medali, dan nol repo tampil 0% bukan NaN", async ({ page }) => {
    await paksaStatus(page, { score_percent: 0, total_repos: 0, gold: 0, silver: 0, bronze: 0 });
    await page.goto("/");

    const statistik = page.locator('section[aria-label="Statistik"]');
    await expect(statistik.locator("svg.lucide-medal")).toHaveCount(1);
    await expect(statistik.getByText("0 repos · 0 gold · 0 silver · 0 bronze")).toBeVisible();
    await expect(statistik.getByText("NaN")).toHaveCount(0);
  });

  test("data nyata: rincian kelas menjumlah ke total repo dan skor cocok rumusnya", async ({
    page,
  }) => {
    await page.goto("/");

    const statistik = page.locator('section[aria-label="Statistik"]');
    const rincian = statistik.getByText(/\d+ repos · \d+ gold · \d+ silver · \d+ bronze/);
    await expect(rincian).toBeVisible();

    const [total, gold, silver, bronze] = (await rincian.textContent())!.match(/\d+/g)!.map(Number);
    expect(gold + silver + bronze).toBe(total);

    const skor = Number(
      (await statistik.getByText(/^\d+%$/).textContent())!.replace("%", ""),
    );
    expect(skor).toBe(total === 0 ? 0 : Math.floor((gold * 100 + silver * 50) / total));
  });
});

test.describe("tanpa sesi — /api/status membawa repository_health", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("kontrak kesehatan repo ada di payload nyata", async ({ request }) => {
    const respons = await request.get("/api/status");

    expect(respons.status()).toBe(200);
    const body = await respons.json();
    expect(Object.keys(body.data.repository_health).sort()).toEqual([
      "bronze",
      "gold",
      "score_percent",
      "silver",
      "total_repos",
    ]);
    for (const nilai of Object.values(body.data.repository_health) as number[]) {
      expect(Number.isInteger(nilai)).toBe(true);
      expect(nilai).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe("tanpa sesi — /api/active", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("GET /api/active tetap terbuka dan berbentuk kontrak", async ({ request }) => {
    const respons = await request.get("/api/active");

    expect(respons.status()).toBe(200);
    const body = await respons.json();
    expect(typeof body.stale).toBe("boolean");
    expect(Array.isArray(body.data.active)).toBe(true);
    expect(body.data.counts).toMatchObject({
      running: expect.any(Number),
      queued: expect.any(Number),
    });
  });
});

// Tombol Sync hanya menarik data baca: tiga GET ke Hono, dan tidak pernah POST
// ke /api/actions — itulah jalur yang men-trigger build Jenkins.
test.describe("tombol Sync", () => {
  test("berputar, terkunci, memunculkan toast, dan tidak pernah POST", async ({ page }) => {
    const bukanGet: string[] = [];
    const urlGet: string[] = [];

    // Ditahan 500 ms supaya keadaan "sedang sync" benar-benar bisa diamati, bukan
    // lolos sekejap di jaringan lokal.
    const tahan = async (route: import("@playwright/test").Route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    };
    await page.route("**/api/status", tahan);
    await page.route("**/api/runs", tahan);
    await page.route("**/api/active", tahan);

    await page.goto("/");
    const tombol = page.getByRole("button", { name: "Sync" });
    await expect(tombol).toBeEnabled();
    // Tunggu sampai tarikan awal selesai. Kalau masih ada permintaan menggantung,
    // Sync sengaja memakai permintaan itu alih-alih menambah hit — jadi tes ini
    // harus berangkat dari keadaan diam supaya bisa menghitung tiga GET.
    await page.waitForLoadState("networkidle");

    // Perekaman dimulai setelah halaman siap, jadi hanya lalu lintas Sync.
    page.on("request", (permintaan) => {
      const url = permintaan.url();
      if (!url.includes("/api/")) return;
      if (permintaan.method() !== "GET") bukanGet.push(`${permintaan.method()} ${url}`);
      else urlGet.push(new URL(url).pathname);
    });

    await tombol.click();

    await expect(tombol).toBeDisabled();
    // Kelas spin tidak cukup: pastikan browser benar-benar membuat animasinya.
    expect(
      await tombol.locator("svg").first().evaluate((el) => el.getAnimations().length),
    ).toBeGreaterThan(0);

    await expect(page.getByText("Data berhasil disinkronkan.")).toBeVisible();
    await expect(tombol).toBeEnabled();

    expect(new Set(urlGet)).toEqual(new Set(["/api/status", "/api/runs", "/api/active"]));
    expect(bukanGet, `permintaan bukan GET saat Sync: ${bukanGet.join(", ")}`).toEqual([]);
  });

  test("toast hilang sendiri sekitar 4 detik", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sync" }).click();

    const toast = page.getByText("Data berhasil disinkronkan.");
    await expect(toast).toBeVisible();
    await expect(toast).toBeHidden({ timeout: 6000 });
  });
});

