import { describe, expect, it } from "vitest";
import { exposeLogin, githubLogin, signInAllowed, stampLogin } from "./auth-callbacks";

describe("githubLogin", () => {
  it("mengambil login dari profil OAuth apa adanya (casing GitHub dipertahankan)", () => {
    expect(githubLogin({ login: "MAliffadlan" })).toBe("MAliffadlan");
    expect(githubLogin({ login: "Tugure-Git-Intern" })).toBe("Tugure-Git-Intern");
    expect(githubLogin({ login: "  alif  " })).toBe("alif"); // hanya dipangkas
  });

  it("mengembalikan string kosong kalau profil tidak memuat login", () => {
    expect(githubLogin({})).toBe("");
    expect(githubLogin(undefined)).toBe("");
    expect(githubLogin({ login: 42 })).toBe("");
    expect(githubLogin({ login: "   " })).toBe("");
  });
});

describe("signInAllowed", () => {
  it("menolak user di luar whitelist", () => {
    expect(signInAllowed({ profile: { login: "orang-lain" } }, ["alif"])).toBe(false);
  });

  it("menerima user di whitelist walau kapitalisasinya berbeda", () => {
    expect(signInAllowed({ profile: { login: "Tugure-Git-Intern" } }, ["tugure-git-intern"])).toBe(
      true,
    );
  });

  it("menolak kalau profil tidak memuat login sama sekali", () => {
    expect(signInAllowed({ profile: {} }, ["alif"])).toBe(false);
    expect(signInAllowed({}, ["alif"])).toBe(false);
  });

  it("menerima login di whitelist walau casing berbeda (whitelist tidak case-sensitive)", () => {
    expect(signInAllowed({ profile: { login: "MAliffadlan" } }, ["maliffadlan"])).toBe(true);
  });

  it("menolak semua orang saat whitelist kosong", () => {
    expect(signInAllowed({ profile: { login: "alif" } }, [])).toBe(false);
  });
});

describe("stampLogin", () => {
  it("menyimpan login apa adanya ke dalam token", () => {
    const token = {};
    expect(stampLogin({ token, profile: { login: "AliF" } }).login).toBe("AliF");
  });

  it("menyimpan string kosong supaya token tanpa login ditolak middleware", () => {
    expect(stampLogin({ token: {}, profile: {} }).login).toBe("");
  });

  it("tidak menghapus isi token yang sudah ada", () => {
    const token = { sub: "12345", name: "Alif" };
    expect(stampLogin({ token, profile: { login: "alif" } })).toMatchObject({
      sub: "12345",
      name: "Alif",
      login: "alif",
    });
  });

  it("mempertahankan login mentah saat callback jalan tanpa profil (pembacaan sesi)", () => {
    // Auth.js memanggil callback jwt lagi setiap sesi dibaca, dan saat itu
    // `profile` tidak dikirim. Tanpa penjagaan ini login akan terhapus dan
    // setiap user yang sah langsung dilempar ke /login. Nilai token juga tidak
    // boleh diubah casingnya di sini: pembacaan sesi bukan alasan untuk
    // menurunkan "MAliffadlan" jadi "maliffadlan".
    const token = { login: "alif", sub: "1" };
    expect(stampLogin({ token })).toMatchObject({ login: "alif", sub: "1" });
    expect(stampLogin({ token: { login: "MAliffadlan" } })).toMatchObject({ login: "MAliffadlan" });
  });

  it("memakai string kosong saat token belum punya login dan tidak ada profil", () => {
    expect(stampLogin({ token: {} }).login).toBe("");
    expect(stampLogin({ token: { login: 42 } }).login).toBe("");
  });
});

describe("exposeLogin", () => {
  it("meneruskan login dari token ke session.user", () => {
    const session = { user: { name: "Alif" }, expires: "nanti" };
    const hasil = exposeLogin({ session, token: { login: "alif" } });
    expect(hasil.user).toMatchObject({ name: "Alif", login: "alif" });
    expect(hasil.expires).toBe("nanti");
  });

  it("memakai string kosong saat token tidak memuat login", () => {
    const hasil = exposeLogin({ session: { user: {} }, token: {} });
    expect(hasil.user).toMatchObject({ login: "" });
  });
});

describe("role di token dan sesi (tampilan UI)", () => {
  it("mengambil role dari peta allowlist saat login, tanpa mengubah casing login", () => {
    const daftar = new Map([
      ["maliffadlan", "dev"] as const,
      ["tugure-git-intern", "admin"] as const,
    ]);
    const token = stampLogin({ token: {}, profile: { login: "MAliffadlan" }, daftar });
    expect(token).toMatchObject({ login: "MAliffadlan", role: "dev" });
  });

  it("login di luar whitelist ber-role null, bukan default admin", () => {
    const daftar = new Map([["alif", "qa"] as const]);
    expect(stampLogin({ token: {}, profile: { login: "orang-luar" }, daftar }).role).toBeNull();
  });

  it("mempertahankan role lama saat sesi dibaca ulang tanpa profil", () => {
    const token = { login: "alif", role: "qa", sub: "1" };
    expect(stampLogin({ token })).toMatchObject({ login: "alif", role: "qa", sub: "1" });
  });

  it("token lama tanpa role jadi null di token dan di session.user", () => {
    expect(stampLogin({ token: { login: "alif" } }).role).toBeNull();
    const hasil = exposeLogin({ session: { user: {} }, token: { login: "alif", role: "dev" } });
    expect(hasil.user).toMatchObject({ login: "alif", role: "dev" });
  });
});
