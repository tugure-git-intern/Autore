import { describe, expect, it } from "vitest";
import type { ApplicationRecord } from "./contracts";
import { cocokCommit, pilihAwal } from "./pilih-app";

const app = (ubah: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  id: "a",
  name: "A",
  status: "unknown",
  last_build: null,
  commit_sha: null,
  security_issues: 0,
  ...ubah,
});

describe("pilihAwal", () => {
  it("memilih aplikasi gagal pertama supaya yang butuh perhatian langsung terlihat", () => {
    const hasil = pilihAwal([app({ id: "a", status: "passed" }), app({ id: "b", status: "failed" })]);

    expect(hasil?.id).toBe("b");
  });

  it("jatuh ke aplikasi pertama kalau tidak ada yang gagal", () => {
    const hasil = pilihAwal([app({ id: "a", status: "passed" }), app({ id: "b", status: "passed" })]);

    expect(hasil?.id).toBe("a");
  });

  it("mengembalikan undefined untuk daftar kosong (bukan aplikasi karangan)", () => {
    expect(pilihAwal([])).toBeUndefined();
  });
});

describe("cocokCommit", () => {
  it("cocok saat CLI menulis short sha sementara snapshot memuat sha panjang", () => {
    expect(cocokCommit("405156b", "405156b1c2d3e4f")).toBe(true);
  });

  it("menolak commit yang berbeda — pipeline global bukan milik aplikasi ini", () => {
    expect(cocokCommit("405156b", "deadbee")).toBe(false);
  });

  it("menolak saat aplikasi belum punya commit (null)", () => {
    expect(cocokCommit("405156b", null)).toBe(false);
    expect(cocokCommit("405156b", "")).toBe(false);
  });

  it("menolak saat pipeline belum melaporkan commit", () => {
    expect(cocokCommit("", "405156b")).toBe(false);
  });

  it("mengabaikan beda huruf besar-kecil pada sha", () => {
    expect(cocokCommit("405156B", "405156b1c2d3")).toBe(true);
  });
});
