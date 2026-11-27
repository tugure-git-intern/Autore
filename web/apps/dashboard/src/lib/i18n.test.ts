import { describe, expect, it } from "vitest";

import { BAHASA, KAMUS, ialahBahasa, terjemah } from "./i18n";

describe("kamus i18n", () => {
  it("hanya id dan en yang diakui; cookie asing ditolak", () => {
    expect(BAHASA).toEqual(["id", "en"]);
    expect(ialahBahasa("id")).toBe(true);
    expect(ialahBahasa("en")).toBe(true);
    for (const nilai of ["", "EN", "jv", null, undefined, 1, {}]) {
      expect(ialahBahasa(nilai)).toBe(false);
    }
  });

  it("setiap bahasa lengkap dan tidak ada teks kosong", () => {
    const kunci = Object.keys(KAMUS.id).sort();
    expect(Object.keys(KAMUS.en).sort()).toEqual(kunci);
    for (const bahasa of BAHASA) {
      for (const k of kunci) {
        expect(KAMUS[bahasa][k as keyof typeof KAMUS.id].trim()).not.toBe("");
      }
    }
  });

  it("istilah CI/CD tidak diterjemahkan, label Indonesia diterjemahkan", () => {
    expect(terjemah("id", "nav.pipeline")).toBe(terjemah("en", "nav.pipeline"));
    expect(terjemah("id", "nav.aplikasi")).toBe("Daftar Aplikasi");
    expect(terjemah("en", "nav.aplikasi")).toBe("Applications");
    expect(terjemah("id", "navbar.sinkron")).toBe("Sinkronkan");
    expect(terjemah("en", "navbar.sinkron")).toBe("Sync");
  });
});
