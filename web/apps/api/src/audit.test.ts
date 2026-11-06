import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catatAudit, jalurAudit } from "./audit";

const BARIS = {
  login: "MAliffadlan",
  email: "maliffadlan@users.noreply.github.com",
  action: "deploy",
  target: "java-tes",
  exit: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env.AUTORE_AUDIT_LOG;
});

describe("catatAudit", () => {
  it("menulis satu baris JSONL, sekaligus membuat folder state yang belum ada", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-"));
    const jalur = join(dir, "state", "autore", "audit.log");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await catatAudit(BARIS, jalur);

    const isi = (await readFile(jalur, "utf8")).trim().split("\n");
    expect(isi).toHaveLength(1);
    expect(JSON.parse(isi[0])).toMatchObject(BARIS);
    expect(JSON.parse(isi[0]).ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("menambah baris, bukan menimpa: lima engineer = lima baris", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-"));
    const jalur = join(dir, "audit.log");
    vi.spyOn(console, "log").mockImplementation(() => {});

    for (const orang of ["MAliffadlan", "tugure-git-intern", "budi", "siti", "andi"]) {
      await catatAudit({ ...BARIS, login: orang }, jalur);
    }

    const baris = (await readFile(jalur, "utf8")).trim().split("\n");
    expect(baris).toHaveLength(5);
    expect(baris.map((b) => JSON.parse(b).login)).toEqual([
      "MAliffadlan",
      "tugure-git-intern",
      "budi",
      "siti",
      "andi",
    ]);
  });

  it("tidak melempar saat jalur tidak bisa ditulis — audit tidak boleh menggagalkan aksi", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-"));
    // `audit.log` "di dalam" sebuah berkas: mkdir/append gagal, tapi aksi tetap jalan.
    await writeFile(join(dir, "bukan-folder"), "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const keluhan = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      catatAudit(BARIS, join(dir, "bukan-folder", "audit.log")),
    ).resolves.toBeUndefined();

    expect(keluhan).toHaveBeenCalledTimes(1);
  });
});

describe("jalurAudit", () => {
  it("default: $XDG_STATE_HOME/autore/audit.log", () => {
    vi.stubEnv("XDG_STATE_HOME", "/tmp/state-uji");

    expect(jalurAudit()).toBe("/tmp/state-uji/autore/audit.log");
  });

  it("AUTORE_AUDIT_LOG menang atas default (dipakai di tes dan kalau state dipindah)", () => {
    vi.stubEnv("AUTORE_AUDIT_LOG", "/tmp/audit-lain.log");

    expect(jalurAudit()).toBe("/tmp/audit-lain.log");
  });
});
