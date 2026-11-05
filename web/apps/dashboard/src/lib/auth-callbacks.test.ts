import { describe, expect, it } from "vitest";
import {
  exposeLogin,
  githubLogin,
  signInAllowed,
  stampLogin,
  type SessionLike,
  type TokenLike,
} from "./auth-callbacks";

describe("githubLogin", () => {
  it("mengambil login dari profil OAuth dan menormalkannya", () => {
    expect(githubLogin({ login: "Tugure-Git-Intern" })).toBe("tugure-git-intern");
    expect(githubLogin({ login: "  alif  " })).toBe("alif");
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

  it("menolak semua orang saat whitelist kosong", () => {
    expect(signInAllowed({ profile: { login: "alif" } }, [])).toBe(false);
  });
});

describe("stampLogin", () => {
  it("menyimpan login hasil normalisasi ke dalam token", () => {
    const token: TokenLike = {};
    expect(stampLogin({ token, profile: { login: "AliF" } }).login).toBe("alif");
  });

  it("menyimpan string kosong supaya token tanpa login ditolak middleware", () => {
    expect(stampLogin({ token: {}, profile: {} }).login).toBe("");
  });

  it("tidak menghapus isi token yang sudah ada", () => {
    const token: TokenLike = { sub: "12345", name: "Alif" };
    expect(stampLogin({ token, profile: { login: "alif" } })).toMatchObject({
      sub: "12345",
      name: "Alif",
      login: "alif",
    });
  });
});

describe("exposeLogin", () => {
  it("meneruskan login dari token ke session.user", () => {
    const session: SessionLike = { user: { name: "Alif" }, expires: "nanti" };
    const hasil = exposeLogin({ session, token: { login: "alif" } });
    expect(hasil.user).toMatchObject({ name: "Alif", login: "alif" });
    expect(hasil.expires).toBe("nanti");
  });

  it("memakai string kosong saat token tidak memuat login", () => {
    const hasil = exposeLogin({ session: { user: {} }, token: {} });
    expect(hasil.user).toMatchObject({ login: "" });
  });
});
