import { expect, test, type Page } from "@playwright/test";

/**
 * Aksi destruktif: hanya jalan lawan server hidup (`E2E_LIVE=1`) dengan app uji
 * sekali-pakai yang SUDAH dibuat lewat `autore connect` (repo uji tanpa
 * `/health`). Mode hermetik memakai binari CLI palsu + fixture statis, jadi tidak
 * bisa membuktikan penghapusan nyata — spec ini di-skip di sana supaya suite
 * lokal tetap hijau tanpa server.
 *
 * Kontrak nama: `AUTORE_E2E_HAPUS_APP` wajib berawalan `hapus-uji-`. Nama di luar
 * pola itu membuat spec skip, bukan menghapus app nyata — menghapus job Jenkins +
 * container bersifat permanen dan tidak bisa dibatalkan. Jangan pernah menunjuk
 * app yang sudah ada di server.
 *
 * Jalankan dari `web/`:
 *   E2E_LIVE=1 AUTORE_E2E_HAPUS_APP=hapus-uji-<timestamp> npm run test:e2e:live
 */
const HIDUP = process.env.E2E_LIVE === "1";
const APP = process.env.AUTORE_E2E_HAPUS_APP ?? "";
const SIAP = HIDUP && APP.startsWith("hapus-uji-");

const NAMA_COOKIE = "authjs.session-token";

/**
 * Menerbitkan cookie admin yang sah lewat `encode()` Auth.js — pola yang sama
 * dengan `e2e/global-setup.ts`, yang hanya membuat sesi dev. Role dihitung API
 * dari allowlist per login (`apps/api/src/session.ts`), jadi login admin nyata
 * (`tugure-git-intern` di `web/allowed-users.json`) yang dipakai, bukan nama
 * karangan; field `role` ikut supaya badge UI konsisten.
 */
async function sesiAdmin(page: Page): Promise<void> {
  const rahasia = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!rahasia) {
    throw new Error("AUTH_SECRET/NEXTAUTH_SECRET kosong; jalankan lewat `npm run test:e2e:live` dari web/.");
  }
  // `next-auth/jwt` ESM, spec dijalankan sebagai CJS — import statis meledak.
  const { encode } = await import("next-auth/jwt");
  const nilai = await encode({
    token: { sub: "e2e-admin", login: "tugure-git-intern", name: "E2E Admin", role: "admin" },
    secret: rahasia,
    salt: NAMA_COOKIE,
    maxAge: 8 * 60 * 60,
  });
  await page.context().addCookies(
    ["127.0.0.1", "100.80.3.14"].map((domain) => ({
      name: NAMA_COOKIE,
      value: nilai,
      domain,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
}

/** Baris tabel app uji. Nama app muncul di sel Nama dan id, jadi saring pada baris. */
function barisApp(page: Page) {
  return page.getByRole("row").filter({ hasText: APP });
}

test.describe("Hapus aplikasi dari /applications", () => {
  test.skip(
    !SIAP,
    "butuh E2E_LIVE=1 + AUTORE_E2E_HAPUS_APP=hapus-uji-<timestamp> (app uji sekali-pakai)",
  );

  // Urutan penting: penolakan dev diuji SELAGI app masih ada; penghapusan admin
  // ditaruh terakhir karena ia membuang app dari daftar.
  test("sesi dev: tombol tetap ada, aksi ditolak 403 tanpa dilempar ke /login", async ({ page }) => {
    await page.goto("/applications");
    const baris = barisApp(page);
    await expect(baris).toBeVisible();

    const hapus = baris.getByRole("button", { name: "Hapus", exact: true });
    await expect(hapus).toBeVisible();
    await hapus.click();

    const dialog = page.getByRole("dialog", { name: "Hapus aplikasi ini dari server?" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Ketik nama aplikasi untuk konfirmasi").fill(APP);
    await dialog.getByRole("button", { name: "Hapus permanen" }).click();

    // 403 = penolakan izin, bukan sesi berakhir: pesan server tampil sebagai
    // toast gagal dan halaman TIDAK berpindah ke /login.
    const toast = page.getByTestId("toast");
    await expect(toast).toHaveAttribute("role", "alert");
    await expect(toast).toContainText("butuh role admin");
    await expect(page).toHaveURL(/\/applications/);
    await expect(barisApp(page)).toBeVisible();
  });

  test("admin: konfirmasi ketik nama menghapus app uji dari daftar", async ({ page }) => {
    await sesiAdmin(page);
    await page.goto("/applications");
    const baris = barisApp(page);
    await expect(baris).toBeVisible();

    await baris.getByRole("button", { name: "Hapus", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Hapus aplikasi ini dari server?" });
    await expect(dialog).toBeVisible();
    // Dialog harus MENYEBUT nama yang wajib diketik: user tak perlu menebak persis
    // (huruf besar & tanda hubung ikut dinilai) dari kolom tabel yang tertutup dialog.
    await expect(dialog).toContainText(`Ketik ${APP} untuk konfirmasi`);
    // Repo GitHub tidak disentuh, riwayat build Jenkins ikut hilang — disebut dialog.
    await expect(dialog).toContainText("Repo GitHub tidak disentuh");
    await expect(dialog).toContainText("Riwayat build ikut hilang");

    const konfirmasi = dialog.getByLabel("Ketik nama aplikasi untuk konfirmasi");
    const permanen = dialog.getByRole("button", { name: "Hapus permanen" });
    await konfirmasi.fill(`${APP}-salah`);
    await expect(permanen).toBeDisabled();
    await konfirmasi.fill(APP);
    await expect(permanen).toBeEnabled();
    await permanen.click();

    const toast = page.getByTestId("toast");
    await expect(toast).toHaveAttribute("role", "status");
    await expect(toast).toContainText("Aplikasi dihapus dari server");
    // `onDone` memuat ulang status: baris app uji hilang dari daftar.
    await expect(barisApp(page)).toHaveCount(0);
  });
});
