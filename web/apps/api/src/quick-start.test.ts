import { describe, expect, it } from "vitest";
import { KODE_SAH, STACK_SAH, argvQuickStart, bacaBodyQuickStart, repoDariOutput } from "./quick-start";

/**
 * Semua validasi di sini adalah cermin `validate_app_name` (cli/src/templates.rs:227):
 * 1-63 karakter, huruf kecil/angka di awal, sisanya huruf kecil/angka/`-`/`_`.
 * Ditegakkan lagi di API supaya `--app-name` tidak pernah bisa menyamar jadi flag.
 */
describe("bacaBodyQuickStart", () => {
  it("menerima body lengkap dan merapikan spasi di tepi nama", () => {
    const hasil = bacaBodyQuickStart({ nama: "  coba-web  ", stack: "nodejs", kode: "contoh" });

    expect(hasil).toEqual({
      ok: true,
      nilai: { nama: "coba-web", stack: "nodejs", kode: "contoh" },
    });
  });

  it("kode default contoh kalau tidak dikirim, dan kode kosong tetap dihormati", () => {
    expect(bacaBodyQuickStart({ nama: "aplikasi-1", stack: "python" })).toEqual({
      ok: true,
      nilai: { nama: "aplikasi-1", stack: "python", kode: "contoh" },
    });
    const kosong = bacaBodyQuickStart({ nama: "aplikasi-1", stack: "python", kode: "kosong" });
    expect(kosong.ok && kosong.nilai.kode).toBe("kosong");
  });

  it("menolak nama yang bisa kabur dari workspace atau menyamar sebagai flag", () => {
    for (const jahat of [
      "",
      "   ",
      "App",
      "../rahasia",
      "a/b",
      "a b",
      "-abc",
      "_abc",
      "--force",
      "a.b",
      "x".repeat(64),
      "nama\u0000",
    ]) {
      const hasil = bacaBodyQuickStart({ nama: jahat, stack: "python" }, );
      expect(hasil.ok, `nama ${JSON.stringify(jahat)} harus ditolak`).toBe(false);
    }
  });

  it("menolak stack di luar whitelist dan stack yang tidak dikirim", () => {
    expect(bacaBodyQuickStart({ nama: "web-1", stack: "ruby" })).toEqual({
      ok: false,
      error: expect.stringContaining("python"),
    });
    expect(bacaBodyQuickStart({ nama: "web-1" })).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });

  it("menolak kode di luar contoh/kosong", () => {
    const hasil = bacaBodyQuickStart({ nama: "web-1", stack: "go", kode: "rm -rf /" });
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.error).toContain("contoh");
  });

  it("menolak body bukan objek, array, dan kunci tak dikenal", () => {
    for (const jahat of [null, "nama", 12, ["nama"], true]) {
      expect(bacaBodyQuickStart(jahat).ok).toBe(false);
    }
    expect(bacaBodyQuickStart({ nama: "web-1", stack: "go", kode: "contoh", port: 8081 }).ok).toBe(
      false,
    );
    expect(bacaBodyQuickStart({ nama: "web-1", stack: "go", app: "lain" }).ok).toBe(false);
  });

  it("whitelist hanya memuat empat bahasa dan dua pilihan kode", () => {
    expect(STACK_SAH).toEqual(["python", "nodejs", "java", "go"]);
    expect(KODE_SAH).toEqual(["contoh", "kosong"]);
  });
});

describe("argvQuickStart", () => {
  it("menyusun argv tetap: path dari unit, tidak ada teks bebas dari browser", () => {
    const args = argvQuickStart("/home/tugure/autore-workspace", {
      nama: "coba-web",
      stack: "nodejs",
      kode: "contoh",
    });

    expect(args).toEqual([
      "quick-start",
      "--path",
      "/home/tugure/autore-workspace",
      "--app-name",
      "coba-web",
      "--stack",
      "nodejs",
      "--kode",
      "contoh",
    ]);
  });
});

describe("repoDariOutput", () => {
  it("mengambil URL repo dari baris 'Repo GitHub owner/nama'", () => {
    const keluaran = [
      "  1/4 File pipeline dibuat:",
      "  2/4 Repo GitHub tugure-git-intern/coba-web (baru dibuat)",
      "  3/4 Push ke Git...",
    ].join("\n");

    expect(repoDariOutput(keluaran)).toBe("https://github.com/tugure-git-intern/coba-web");
  });

  it("mengabaikan kode warna kalau CLI masih mengirimnya", () => {
    expect(repoDariOutput("  2/4 Repo GitHub \u001b[32mowner/nama\u001b[0m (sudah ada)")).toBe(
      "https://github.com/owner/nama",
    );
  });

  it("mengembalikan string kosong kalau baris repo tidak ada", () => {
    expect(repoDariOutput("  ERROR: Token GitHub ditolak (HTTP 401).")).toBe("");
  });
});
