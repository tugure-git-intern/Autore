import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Role } from "@autore/contracts";
import {
  bacaBerkas,
  jumlahAdmin,
  sidik,
  tulisBerkas,
  validasiEntri,
} from "./allowlist-berkas";

const folder = () => mkdtemp(join(tmpdir(), "autore-allowlist-"));

const AWAL = { maliffadlan: "dev", "tugure-git-intern": "admin" } as const;

async function berkasAwal() {
  const dir = await folder();
  const jalur = join(dir, "allowed-users.json");
  await writeFile(jalur, JSON.stringify(AWAL, null, 2));
  return { dir, jalur };
}

describe("validasiEntri", () => {
  it("menormalkan huruf besar dan spasi tepi", () => {
    const hasil = validasiEntri([{ login: "  MAliffadlan ", role: "admin" }]);
    expect(hasil.ok).toBe(true);
    if (hasil.ok) expect([...hasil.peta]).toEqual([["maliffadlan", "admin"]]);
  });

  it.each([
    ["", "kosong"],
    ["-alif", "tanda hubung di awal"],
    ["alif-", "tanda hubung di akhir"],
    ["alif_dua", "garis bawah"],
    ["a".repeat(40), "40 karakter"],
    ["alif budi", "spasi di tengah"],
  ])("menolak login %j (%s)", (login) => {
    const hasil = validasiEntri([{ login, role: "dev" }]);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.error).toContain("login tidak sah");
  });

  it("menolak role asing, tidak pernah menaikkannya jadi admin", () => {
    const hasil = validasiEntri([{ login: "alif", role: "owner" as Role }]);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.error).toContain("role tidak dikenal");
  });

  it("menolak login ganda setelah normalisasi", () => {
    const hasil = validasiEntri([
      { login: "alif", role: "dev" },
      { login: "Alif", role: "admin" },
    ]);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.error).toContain("ganda");
  });

  it("tanpa admin pun lolos validasi bentuk; aturan admin terakhir di route", () => {
    const hasil = validasiEntri([{ login: "alif", role: "dev" }]);
    expect(hasil.ok).toBe(true);
    if (hasil.ok) expect(jumlahAdmin(hasil.peta)).toBe(0);
  });
});

describe("bacaBerkas", () => {
  it("mengembalikan peta + revisi sidik isi mentah", async () => {
    const { jalur } = await berkasAwal();
    const hasil = await bacaBerkas(jalur);
    expect(hasil.baru).toBe(false);
    expect([...hasil.peta]).toEqual([
      ["maliffadlan", "dev"],
      ["tugure-git-intern", "admin"],
    ]);
    expect(hasil.revisi).toBe(sidik(await readFile(jalur, "utf8")));
  });

  it("berkas belum ada = peta kosong bertanda baru, bukan galat", async () => {
    const dir = await folder();
    const hasil = await bacaBerkas(join(dir, "belum-ada.json"));
    expect(hasil.baru).toBe(true);
    expect(hasil.peta.size).toBe(0);
  });
});

describe("tulisBerkas", () => {
  it("menulis peta terurut, mode 0644, backup berisi isi lama, tanpa .tmp tersisa", async () => {
    const { dir, jalur } = await berkasAwal();
    const backup = await tulisBerkas(
      new Map<string, Role>([
        ["tugure-git-intern", "admin"],
        ["maliffadlan", "dev"],
        ["ryusicode", "qa"],
      ]),
      jalur,
    );

    expect(JSON.parse(await readFile(jalur, "utf8"))).toEqual({
      maliffadlan: "dev",
      ryusicode: "qa",
      "tugure-git-intern": "admin",
    });
    expect(JSON.parse(await readFile(backup, "utf8"))).toEqual(AWAL);
    expect(await readdir(dir)).toEqual(["allowed-users.json", backup.split("/").pop()]);
  });

  it("gagal rename = melempar galat dan tidak meninggalkan berkas .tmp", async () => {
    const { dir } = await berkasAwal();
    // Tujuan berupa FOLDER: `rename(berkas, folder)` gagal (EISDIR), bukan
    // menimpa seperti rename ke berkas biasa.
    const tujuan = join(dir, "tujuan");
    await mkdir(tujuan);

    await expect(tulisBerkas(new Map([["alif", "admin"]]), tujuan)).rejects.toThrow();
    expect((await readdir(dir)).filter((n) => n.includes(".allowed-users.tmp"))).toEqual([]);
  });

  it("round-trip: hasil tulis terbaca parseAllowlist sebagai peta yang sama", async () => {
    const { jalur } = await berkasAwal();
    const peta = new Map<string, Role>([
      ["alif", "admin"],
      ["budi", "qa"],
    ]);
    await tulisBerkas(peta, jalur);
    expect([...(await bacaBerkas(jalur)).peta]).toEqual([...peta]);
  });
});
