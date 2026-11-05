import { describe, expect, it } from "vitest";
import type { SbomPackage } from "./contracts";
import { filterPackages } from "./filter-sbom";

const PAKET: SbomPackage[] = [
  { name: "openssl", version: "3.0.11", type: "os" },
  { name: "express", version: "4.18.2", type: "language" },
  { name: "libc6", version: "2.36-9", type: "os" },
  { name: "tanpa-versi", version: "", type: "language" },
];

const nama = (hasil: SbomPackage[]) => hasil.map((p) => p.name);

describe("filterPackages", () => {
  it("mengembalikan semua paket saat pencarian kosong atau hanya spasi", () => {
    expect(nama(filterPackages(PAKET, ""))).toEqual(nama(PAKET));
    expect(nama(filterPackages(PAKET, "   "))).toEqual(nama(PAKET));
  });

  it("mencocokkan nama tanpa peduli huruf besar/kecil dan memangkas spasi", () => {
    expect(nama(filterPackages(PAKET, "OPENSSL"))).toEqual(["openssl"]);
    expect(nama(filterPackages(PAKET, " expr "))).toEqual(["express"]);
    expect(nama(filterPackages(PAKET, "bc"))).toEqual(["libc6"]);
  });

  it("mencocokkan versi juga, bukan hanya nama", () => {
    expect(nama(filterPackages(PAKET, "3.0.11"))).toEqual(["openssl"]);
    expect(nama(filterPackages(PAKET, "2.36"))).toEqual(["libc6"]);
  });

  it("mengembalikan daftar kosong kalau tidak ada yang cocok", () => {
    expect(filterPackages(PAKET, "zzz")).toEqual([]);
  });

  it("tidak mengubah urutan asli dari CLI", () => {
    expect(nama(filterPackages(PAKET, "s"))).toEqual(["openssl", "express", "tanpa-versi"]);
  });
});
