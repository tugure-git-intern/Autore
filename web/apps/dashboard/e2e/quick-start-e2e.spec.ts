import { expect, test } from "@playwright/test";
import path from "node:path";

// Sama seperti spec lain: bukan golden test, manusia yang melihat PNG-nya.
const screenshotsDir = path.join(process.cwd(), "e2e", "__screenshots__");
const shot = (name: string) => path.join(screenshotsDir, `${name}.png`);

const ENDPOINT = "/api/actions/quick-start";

/**
 * Aksi ini MEMBUAT repo GitHub publik + job Jenkins, dan tidak bisa dibatalkan.
 * Karena itu spec ini sengaja tidak pernah menekan tombol eksekusinya: yang diuji
 * hanya gerbang UI (tombol disabled, konfirmasi nama) dan penolakan endpoint
 * untuk body yang salah. Pembuatan aplikasi sungguhan diuji manusia dari dashboard.
 */
test.describe("Buat Aplikasi Baru (quick-start) @1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("dialog dua langkah: nama tidak sah memblokir, konfirmasi nama membuka gerbang", async ({
    page,
  }) => {
    await page.goto("/applications");
    await page.getByRole("button", { name: /Buat Aplikasi Baru/ }).click();

    const lanjut = page.getByRole("button", { name: "Lanjut" });
    await expect(lanjut).toBeVisible();
    await expect(lanjut).toBeDisabled();

    const nama = page.getByLabel("Nama Aplikasi");
    await nama.fill("--force");
    // Next memasang route announcer ber-role "alert" juga, jadi locator-nya dipersempit.
    await expect(page.getByRole("alert").filter({ hasText: "Nama aplikasi tidak sah" })).toBeVisible();
    await expect(lanjut).toBeDisabled();

    await nama.fill("Coba Web");
    await expect(lanjut).toBeDisabled();

    await nama.fill("coba-web");
    await expect(lanjut).toBeEnabled();
    await page.getByLabel("Bahasa").selectOption("go");
    await lanjut.click();

    await expect(page.getByText(/repository PUBLIK di GitHub/)).toBeVisible();
    await expect(page.getByText(/tidak bisa dibatalkan/)).toBeVisible();

    // exact: tombol pemicu "Buat Aplikasi Baru" juga cocok kalau tidak dipersempit.
    const eksekusi = page.getByRole("button", { name: "Buat Aplikasi", exact: true });
    await expect(eksekusi).toBeDisabled();

    const konfirmasi = page.getByLabel("Ketik nama aplikasi untuk konfirmasi");
    await konfirmasi.fill("coba-we");
    await expect(eksekusi).toBeDisabled();

    await konfirmasi.fill("coba-web");
    await expect(eksekusi).toBeEnabled();

    await page.screenshot({ path: shot("quick-start-konfirmasi") });
  });

  test("membatalkan dialog tidak pernah mengirim permintaan ke endpoint aksi", async ({ page }) => {
    const panggilan: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/actions/")) panggilan.push(`${req.method()} ${req.url()}`);
    });

    await page.goto("/applications");
    await page.getByRole("button", { name: /Buat Aplikasi Baru/ }).click();
    await page.getByLabel("Nama Aplikasi").fill("coba-web");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByRole("button", { name: "Kembali" }).click();
    await page.getByRole("button", { name: "Batal" }).click();

    await expect(page.locator("dialog")).not.toHaveAttribute("open");
    expect(panggilan).toEqual([]);
  });

  test("endpoint menolak nama, bahasa, dan kode yang tidak sah dengan 400", async ({ request }) => {
    const kirim = async (data: unknown) => {
      const res = await request.post(ENDPOINT, { data });
      return { status: res.status(), body: (await res.json()) as { error?: string } };
    };

    const namaJahat = await kirim({ nama: "../evil", stack: "python", kode: "contoh" });
    expect(namaJahat.status).toBe(400);
    expect(namaJahat.body.error).toContain("nama aplikasi tidak sah");

    const stackAsing = await kirim({ nama: "coba-web", stack: "ruby", kode: "contoh" });
    expect(stackAsing.status).toBe(400);
    expect(stackAsing.body.error).toContain("python");

    const kodeAsing = await kirim({ nama: "coba-web", stack: "python", kode: "gratis" });
    expect(kodeAsing.status).toBe(400);
    expect(kodeAsing.body.error).toContain("kode harus salah satu dari");

    const kunciAsing = await kirim({ nama: "coba-web", stack: "python", force: true });
    expect(kunciAsing.status).toBe(400);
    expect(kunciAsing.body.error).toContain("hanya boleh memuat kunci");
  });

  test("endpoint menolak body yang bukan JSON dengan 400", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: { "content-type": "application/json" },
      data: "{bukan json",
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("body harus JSON");
  });

  // `test.use` di describe bersarang: `request.newContext()` mewarisi storageState
  // global-setup, jadi tanpanya permintaan ini justru lolos guard dan MENJALANKAN
  // quick-start sungguhan (repo publik + job Jenkins dibuat). Cookie dikosongkan di
  // level konfigurasi, dan body-nya sengaja tidak sah supaya tidak ada jalur menuju
  // spawn sekalipun guard-nya gagal.
  test.describe("tanpa sesi", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("endpoint menolak dengan 401, bukan menjalankan CLI", async ({ request }) => {
      const res = await request.post(ENDPOINT, {
        data: { nama: "../evil", stack: "python", kode: "contoh" },
      });

      expect(res.status()).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("repo");
      expect(JSON.stringify(body)).not.toContain("github.com");
    });
  });
});
