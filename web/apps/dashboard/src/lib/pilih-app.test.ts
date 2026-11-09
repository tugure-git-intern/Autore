import { describe, expect, it } from "vitest";
import type { ApplicationRecord } from "./contracts";
import { cocokCommit, cocokPipeline, pilihAwal } from "./pilih-app";

const app = (ubah: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  id: "a",
  name: "A",
  status: "unknown",
  last_build: "",
  commit_sha: "",
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

/** Ringkasan yang cukup untuk guard: id, status, commit. */
const ringkas = (id: string, status: ApplicationRecord["status"], commit_sha: string | null) => ({
  id,
  status,
  commit_sha,
});

describe("cocokPipeline", () => {
  it("menolak timeline hijau workspace saat aplikasi yang dipilih sedang gagal", () => {
    // Kasus nyata: tes-java gagal di commit aab9fb4, autore-dummy sukses di sha pendek
    // yang kebetulan sama. Record global tidak boleh diklaim sebagai milik tes-java.
    const tesJava = ringkas("tes-java", "failed", "aab9fb4");
    const dummy = ringkas("autore-dummy", "passed", "aab9fb4");

    expect(cocokPipeline({ commit_sha: "aab9fb4", status: "passed" }, tesJava, [tesJava, dummy])).toBe(false);
  });

  it("menolak record global saat sha pendeknya kembar di dua aplikasi", () => {
    const a = ringkas("tes-java", "passed", "aab9fb4");
    const b = ringkas("autore-dummy", "passed", "aab9fb4c1d2");

    expect(cocokPipeline({ commit_sha: "aab9fb4", status: "passed" }, a, [a, b])).toBe(false);
  });

  it("menerima saat commit dan status sejalan", () => {
    const a = ringkas("tes-java", "failed", "aab9fb4c1d2e3f4");

    expect(cocokPipeline({ commit_sha: "aab9fb4", status: "failed" }, a, [a])).toBe(true);
  });

  it("menerima saat aplikasi belum punya status final (masih berjalan)", () => {
    const a = ringkas("tes-java", "running", "aab9fb4c1d2");

    expect(cocokPipeline({ commit_sha: "aab9fb4", status: "passed" }, a, [a])).toBe(true);
  });

  it("tidak menerima sha pendek yang bukan bukti identitas", () => {
    expect(cocokCommit("aab9fb", "aab9fb4")).toBe(false);
  });
});
