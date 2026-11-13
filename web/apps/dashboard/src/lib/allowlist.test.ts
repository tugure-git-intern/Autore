import { describe, expect, it } from "vitest";
import berkas from "../../../../allowed-users.json";
import { allowedList, allowlistMap, isAllowed, normalizeLogin, parseAllowedUsers } from "./allowlist";
import { parseRole } from "./roles";

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
  it("berisi peta login → role yang ternormalisasi dan ber-role dikenal", () => {
    expect(Array.isArray(berkas)).toBe(false);
    const peta = allowlistMap(berkas, undefined);
    expect(peta.size).toBeGreaterThan(0);
    for (const [login, role] of peta) {
      expect(login).toBe(normalizeLogin(login));
      expect(login).not.toBe("");
      expect(parseRole(role)).toBe(role);
    }
    expect(peta.get("tugure-git-intern")).toBe("admin");
    expect(peta.get("maliffadlan")).toBe("dev");
  });

  it("tidak memuat entri qa selama username GitHub-nya belum ada", () => {
    // Menulis username karangan supaya peran qa "ada" hanya membuat whitelist
    // terlihat lebih lengkap daripada kenyataannya.
    expect([...allowlistMap(berkas, undefined).values()]).not.toContain("qa");
  });
});
