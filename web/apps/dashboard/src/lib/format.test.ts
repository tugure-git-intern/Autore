import { describe, expect, it } from "vitest";
import { formatDuration, formatLeadTime, inisial, relativeTime, shortSha } from "./format";

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

describe("formatLeadTime", () => {
  it("memformat selisih finished_at dan started_at ke Xm Ys", () => {
    expect(
      formatLeadTime({
        started_at: "2026-11-04T10:00:00Z",
        finished_at: "2026-11-04T10:01:45Z",
      }),
    ).toBe("1m 45s");
    expect(
      formatLeadTime({
        started_at: "2026-11-04T10:00:00Z",
        finished_at: "2026-11-04T10:00:46Z",
      }),
    ).toBe("0m 46s");
    expect(
      formatLeadTime({
        started_at: "2026-11-04T10:00:00Z",
        finished_at: "2026-11-04T10:00:00Z",
      }),
    ).toBe("0m 0s");
  });

  it("fallback ke stage_times[0].at bila started_at belum ada", () => {
    expect(
      formatLeadTime({
        stage_times: [{ id: "checkout", at: "2026-11-04T10:00:00Z" }],
        finished_at: "2026-11-04T10:01:45Z",
      }),
    ).toBe("1m 45s");
  });

  it("prioritaskan started_at bila keduanya tersedia", () => {
    expect(
      formatLeadTime({
        started_at: "2026-11-04T10:00:00Z",
        stage_times: [{ id: "checkout", at: "2026-11-04T10:00:10Z" }],
        finished_at: "2026-11-04T10:01:45Z",
      }),
    ).toBe("1m 45s");
  });

  it("mengembalikan hyphen minus bila data kosong atau tidak valid", () => {
    expect(formatLeadTime()).toBe("-");
    expect(formatLeadTime(null)).toBe("-");
    expect(formatLeadTime({})).toBe("-");
    expect(formatLeadTime({ started_at: "2026-11-04T10:00:00Z" })).toBe("-");
    expect(formatLeadTime({ finished_at: "2026-11-04T10:00:00Z" })).toBe("-");
    expect(
      formatLeadTime({
        started_at: "bukan-tanggal",
        finished_at: "2026-11-04T10:00:00Z",
      }),
    ).toBe("-");
    expect(
      formatLeadTime({
        started_at: "2026-11-04T10:05:00Z",
        finished_at: "2026-11-04T10:00:00Z",
      }),
    ).toBe("-");
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

describe("inisial", () => {
  it("mengambil dua huruf pertama, mengabaikan bagian email", () => {
    expect(inisial("Alif Fadlan")).toBe("AF");
    expect(inisial("Autore CLI <autore@tugu-re.com>")).toBe("AC");
  });

  it("nama satu kata jadi satu huruf", () => {
    expect(inisial("tugure")).toBe("T");
  });

  it("nama kosong jadi tanda tanya, bukan string kosong", () => {
    expect(inisial("")).toBe("?");
    expect(inisial("   ")).toBe("?");
    expect(inisial("<only@email.test>")).toBe("?");
  });
});

describe("relativeTime — umur log seminggu", () => {
  it("tetap dihitung dalam hari, bukan pindah ke minggu", () => {
    expect(relativeTime("2026-10-28T10:00:00Z", SEKARANG)).toBe("7 hari lalu");
    expect(relativeTime("2026-10-21T10:00:00Z", SEKARANG)).toBe("14 hari lalu");
    expect(relativeTime("2026-10-04T10:00:00Z", SEKARANG)).toBe("31 hari lalu");
  });
});
