import { describe, expect, it } from "vitest";
import berkas from "../../../../allowed-users.json";
import { allowedList, isAllowed, normalizeLogin, parseAllowedUsers } from "./allowlist";

describe("normalizeLogin", () => {
  it("memangkas spasi tepi dan menurunkan jadi huruf kecil", () => {
    expect(normalizeLogin("  AliF ")).toBe("alif");
    expect(normalizeLogin("TUGURE-git-Intern")).toBe("tugure-git-intern");
    expect(normalizeLogin("")).toBe("");
  });
});

describe("parseAllowedUsers", () => {
  it("memecah daftar koma, membuang entri kosong, dan menormalkan tiap nama", () => {
    expect(parseAllowedUsers("alif, Tugure-git-intern ,, ")).toEqual([
      "alif",
      "tugure-git-intern",
    ]);
  });

  it("membuang duplikat yang beda kapitalisasi", () => {
    expect(parseAllowedUsers("alif, Alif, ALIF")).toEqual(["alif"]);
  });

  it("mengembalikan daftar kosong saat env tidak ada atau cuma spasi", () => {
    expect(parseAllowedUsers(undefined)).toEqual([]);
    expect(parseAllowedUsers("   ")).toEqual([]);
    expect(parseAllowedUsers(",")).toEqual([]);
  });
});

describe("allowedList", () => {
  it("memakai isi env saat env berisi sesuatu", () => {
    expect(allowedList(["dari-file"], "alif")).toEqual(["alif"]);
  });

  it("kembali ke isi file saat env tidak di-set atau kosong", () => {
    expect(allowedList(["dari-file"], undefined)).toEqual(["dari-file"]);
    expect(allowedList([" AliF "], "   ")).toEqual(["alif"]);
  });

  it("tidak menambah izin saat dua-duanya kosong", () => {
    expect(allowedList([], undefined)).toEqual([]);
  });
});

describe("isAllowed", () => {
  it("mencocokkan walau kapitalisasi whitelist dan login GitHub berbeda", () => {
    expect(isAllowed("Alif", ["alif", "tugure-git-intern"])).toBe(true);
    expect(isAllowed("alif", ["Alif"])).toBe(true);
  });

  it("menolak login kosong dan login di luar daftar", () => {
    expect(isAllowed("", ["alif"])).toBe(false);
    expect(isAllowed("   ", ["alif"])).toBe(false);
    expect(isAllowed("budi", ["alif"])).toBe(false);
  });

  it("tidak pernah meloloskan siapa pun saat daftar kosong", () => {
    expect(isAllowed("alif", [])).toBe(false);
  });
});

describe("berkas allowed-users.json", () => {
  it("berisi array nama yang sudah ternormalisasi dan tidak kosong", () => {
    expect(Array.isArray(berkas)).toBe(true);
    expect(berkas.length).toBeGreaterThan(0);
    for (const nama of berkas) {
      expect(typeof nama).toBe("string");
      expect(nama).toBe(normalizeLogin(nama));
      expect(nama).not.toBe("");
    }
  });
});
