import { describe, expect, it } from "vitest";
import { formatDuration, relativeTime, shortSha } from "./format";

const SEKARANG = Date.parse("2026-11-04T10:00:00Z");

describe("relativeTime", () => {
  it("memakai bahasa Indonesia dan pembulatan ke bawah", () => {
    expect(relativeTime("2026-11-04T09:59:40Z", SEKARANG)).toBe("baru saja");
    expect(relativeTime("2026-11-04T09:55:00Z", SEKARANG)).toBe("5 menit lalu");
    expect(relativeTime("2026-11-04T07:00:00Z", SEKARANG)).toBe("3 jam lalu");
    expect(relativeTime("2026-11-01T10:00:00Z", SEKARANG)).toBe("3 hari lalu");
  });

  it("tidak pernah menghasilkan waktu negatif", () => {
    expect(relativeTime("2026-11-04T10:01:00Z", SEKARANG)).toBe("baru saja");
  });

  it("waktu atau tanggal tidak sah jadi strip", () => {
    expect(relativeTime("", SEKARANG)).toBe("—");
    expect(relativeTime("bukan-tanggal", SEKARANG)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("memilih satuan sesuai besaran", () => {
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(45_244)).toBe("45.2s");
    expect(formatDuration(96_000)).toBe("1m 36s");
    expect(formatDuration(3_600_000)).toBe("60m 0s");
  });

  it("durasi yang belum ada jadi strip, bukan 0s palsu", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("shortSha", () => {
  it("memotong tujuh karakter", () => {
    expect(shortSha("2dfd6ef3b42a965dd03c392095a116faf1c8a8c2")).toBe("2dfd6ef");
  });

  it("sha kosong jadi strip", () => {
    expect(shortSha("")).toBe("—");
    expect(shortSha("   ")).toBe("—");
  });
});
