import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bacaRegistry, catatAplikasi, portBebas, portDeployBerikut } from "./registry";

async function workspace(isi?: string) {
  const dir = await mkdtemp(join(tmpdir(), "autore-registry-"));
  if (isi !== undefined) await writeFile(join(dir, "registry.tsv"), isi);
  return dir;
}

const isi = (dir: string) => readFile(join(dir, "registry.tsv"), "utf8");

/** Host uji bisa punya port 8003, 8013, ... terpakai (aplikasi nyata jalan), jadi
 *  jalur port diuji dengan probe tiruan supaya hasilnya tidak tergantung mesin. */
const SELALU_BEBAS = { bebas: () => true };

describe("bacaRegistry", () => {
  it("membaca baris nama, port app, port deploy", () => {
    expect(bacaRegistry("tes-web\t8000\t8003\nui-demo\t8000\t8023\n")).toEqual([
      { nama: "tes-web", app: 8000, deploy: 8003 },
      { nama: "ui-demo", app: 8000, deploy: 8023 },
    ]);
  });

  it("melewati baris rusak dan baris kosong, bukan menggagalkan aksi", () => {
    expect(bacaRegistry("\nbaris-sampah\nuji\t8000\tbukan-angka\ntes-web\t8000\t8053\n")).toEqual([
      { nama: "tes-web", app: 8000, deploy: 8053 },
    ]);
  });

  it("file kosong atau belum ada sama dengan daftar kosong", () => {
    expect(bacaRegistry("")).toEqual([]);
  });
});

describe("portDeployBerikut", () => {
  it("mulai dari 8003 dan melompat 10 supaya tidak tabrakan", () => {
    expect(portDeployBerikut([], () => true)).toBe(8003);
    expect(portDeployBerikut([8003], () => true)).toBe(8013);
  });

  it("melewati port yang sedang dipakai proses lain", () => {
    const terpakai = new Set([8013]);
    expect(portDeployBerikut([8003], (p) => !terpakai.has(p))).toBe(8023);
  });

  it("berhenti sebelum 8200 kalau semuanya terpakai", () => {
    const semua = Array.from({ length: 20 }, (_, i) => 8003 + i * 10);
    expect(portDeployBerikut(semua, () => true)).toBe(8203);
  });
});

describe("portBebas", () => {
  it("bilang tidak bebas kalau ada yang sedang listen di port itu", async () => {
    const server = createServer();
    await new Promise<void>((siap) => server.listen(0, "127.0.0.1", () => siap()));
    const port = (server.address() as { port: number }).port;

    expect(await portBebas(port)).toBe(false);

    await new Promise<void>((tutup) => server.close(() => tutup()));
  });
});

describe("catatAplikasi", () => {
  it("menambahkan baris baru dengan port app 8000 lalu mengembalikan port deploy", async () => {
    const dir = await workspace("tes-web\t8000\t8003\n");

    const port = await catatAplikasi(dir, "tugas-magang", SELALU_BEBAS);

    expect(port).toBe(8013);
    expect(await isi(dir)).toBe("tes-web\t8000\t8003\ntugas-magang\t8000\t8013\n");
  });

  it("membuat file registry kalau belum ada", async () => {
    const dir = await workspace();

    const port = await catatAplikasi(dir, "app-baru", SELALU_BEBAS);

    expect(port).toBe(8003);
    expect(await isi(dir)).toBe("app-baru\t8000\t8003\n");
  });

  it("idempoten: aplikasi yang sudah terdaftar tidak ditulis dua kali", async () => {
    const dir = await workspace("tugas-magang\t8000\t8013\n");

    const ulang = await catatAplikasi(dir, "tugas-magang", SELALU_BEBAS);
    await catatAplikasi(dir, "tugas-magang", SELALU_BEBAS);

    expect(ulang).toBe(8013);
    expect(await isi(dir)).toBe("tugas-magang\t8000\t8013\n");
  });

  it("mempertahankan baris rusak apa adanya saat menambah", async () => {
    const dir = await workspace("baris-sampah\ntes-web\t8000\t8003\n");

    await catatAplikasi(dir, "app-baru", SELALU_BEBAS);

    expect(await isi(dir)).toBe("baris-sampah\ntes-web\t8000\t8003\napp-baru\t8000\t8013\n");
  });

  it("menambah penutup baris kalau file lama tidak berakhir newline", async () => {
    const dir = await workspace("tes-web\t8000\t8003");

    await catatAplikasi(dir, "app-baru", SELALU_BEBAS);

    expect(await isi(dir)).toBe("tes-web\t8000\t8003\napp-baru\t8000\t8013\n");
  });

  it("menganggap port yang sedang dipakai proses lain sebagai tidak bebas", async () => {
    const dir = await workspace("tes-web\t8000\t8003\n");
    const bebas = vi.fn((p: number) => p !== 8013);

    const port = await catatAplikasi(dir, "app-baru", { bebas });

    expect(port).toBe(8023);
    expect(await isi(dir)).toBe("tes-web\t8000\t8003\napp-baru\t8000\t8023\n");
  });
});
