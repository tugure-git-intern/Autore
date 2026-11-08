import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catatAudit, jalurAudit, bacaAudit } from "./audit";

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

describe("bacaAudit", () => {
  it("mengembalikan array kosong jika berkas audit belum ada", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-empty-"));
    const hasil = await bacaAudit(100, join(dir, "tidak-ada.log"));
    expect(hasil).toEqual([]);
  });

  it("membaca baris JSONL, mem-parse atribut, urut terbaru duluan (ts descending)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-read-"));
    const jalur = join(dir, "audit.log");
    const baris1 = { ts: "2026-11-06T10:00:00.000Z", login: "user1", email: "u1@tugu.com", action: "scan", target: "app1", exit: 0 };
    const baris2 = { ts: "2026-11-07T12:00:00.000Z", login: "user2", email: "u2@tugu.com", action: "deploy", target: "app2", exit: 0 };
    const baris3 = { ts: "2026-11-08T08:00:00.000Z", login: "user3", email: "u3@tugu.com", action: "quick-start", target: "app3", exit: 1 };
    await writeFile(jalur, `${JSON.stringify(baris1)}\n${JSON.stringify(baris2)}\n${JSON.stringify(baris3)}\n`, "utf8");

    const hasil = await bacaAudit(100, jalur);
    expect(hasil).toHaveLength(3);
    // Terbaru (baris3) harus di urutan index 0
    expect(hasil[0]).toEqual(baris3);
    expect(hasil[1]).toEqual(baris2);
    expect(hasil[2]).toEqual(baris1);
  });

  it("membatasi jumlah baris sesuai parameter max", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-limit-"));
    const jalur = join(dir, "audit.log");
    let content = "";
    for (let i = 1; i <= 10; i++) {
      const pad = i.toString().padStart(2, "0");
      const b = { ts: `2026-11-08T00:${pad}:00.000Z`, login: `user${i}`, email: `u${i}@t.com`, action: "deploy", target: `app${pad}`, exit: 0 };
      content += JSON.stringify(b) + "\n";
    }
    await writeFile(jalur, content, "utf8");

    const hasil = await bacaAudit(3, jalur);
    expect(hasil).toHaveLength(3);
    expect(hasil[0].target).toBe("app10");
    expect(hasil[1].target).toBe("app09");
    expect(hasil[2].target).toBe("app08");
  });

  it("mengabaikan baris kosong atau bukan JSON yang sah", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-corrupt-"));
    const jalur = join(dir, "audit.log");
    const barisSah = { ts: "2026-11-08T10:00:00.000Z", login: "user1", email: "u1@t.com", action: "deploy", target: "app1", exit: 0 };
    await writeFile(jalur, `\n{bukan json}\n${JSON.stringify(barisSah)}\n   \n`, "utf8");

    const hasil = await bacaAudit(100, jalur);
    expect(hasil).toEqual([barisSah]);
  });
});
describe("bacaAudit — QA audit log", () => {
  it("menjaga 10.000 baris tetap responsif: hanya 100 baris terbaru yang dihasilkan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-besar-"));
    const jalur = join(dir, "audit.log");
    const baris: string[] = [];
    for (let i = 1; i <= 10_000; i++) {
      baris.push(
        JSON.stringify({
          ts: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          login: `user${i}`,
          email: `u${i}@tugu.com`,
          action: "deploy",
          target: `app${i}`,
          exit: 0,
        }),
      );
    }
    await writeFile(jalur, `${baris.join("\n")}\n`, "utf8");

    const mulai = Date.now();
    const hasil = await bacaAudit(100, jalur);
    const durasi = Date.now() - mulai;

    expect(hasil).toHaveLength(100);
    expect(hasil[0].target).toBe("app10000");
    expect(hasil[99].target).toBe("app9901");
    expect(durasi).toBeLessThan(1000);
  });

  it("melengkapi baris yang field-nya hilang: string kosong dan exit null, bukan undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-audit-kurang-"));
    const jalur = join(dir, "audit.log");
    await writeFile(
      jalur,
      `${JSON.stringify({ ts: "2026-11-08T10:00:00.000Z", action: "deploy" })}\n`,
      "utf8",
    );

    const [baris] = await bacaAudit(100, jalur);

    expect(baris).toEqual({
      ts: "2026-11-08T10:00:00.000Z",
      action: "deploy",
      login: "",
      email: "",
      target: "",
      exit: null,
    });
  });
});
