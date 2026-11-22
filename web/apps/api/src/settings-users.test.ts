import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Identitas } from "./session";
import { hatchSettings } from "./settings-users";

/**
 * Perilaku halaman Pengaturan → Pengguna & Role di tingkat handler: revisi basi,
 * admin terakhir, env yang menimpa berkas, dan audit. Route Hono hanya
 * menambahkan gerbang role dan batas body (diuji di `settings-users-route.test.ts`).
 */

const AKTOR: Identitas = { login: "alif", nama: "Alif", email: "alif@example.com" };

const AWAL = { "tugure-git-intern": "admin", maliffadlan: "dev" };

async function siapkan(awal: unknown = AWAL) {
  const dir = await mkdtemp(join(tmpdir(), "autore-settings-"));
  const jalur = join(dir, "allowed-users.json");
  await writeFile(jalur, JSON.stringify(awal, null, 2));
  const audit = vi.fn(async () => {});
  return { dir, jalur, audit, handler: hatchSettings({ jalur: () => jalur, audit }) };
}

describe("settings pengguna: baca", () => {
  it("mengirim sumber berkas, terurut, dan revisi yang bisa dikirim balik", async () => {
    const { handler } = await siapkan();
    const payload = await handler.baca(AKTOR);
    expect(payload.sumber).toBe("berkas");
    expect(payload.bisaDiubah).toBe(true);
    expect(payload.users).toEqual([
      { login: "maliffadlan", role: "dev" },
      { login: "tugure-git-intern", role: "admin" },
    ]);
    expect(payload.revisi).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("settings pengguna: simpan", () => {
  it("menyimpan perubahan, mengembalikan jalur backup, dan mencatat audit", async () => {
    const { jalur, audit, handler, dir } = await siapkan();
    const { revisi } = await handler.baca(AKTOR);

    const hasil = await handler.simpan(AKTOR, {
      revisi,
      users: [
        { login: "maliffadlan", role: "qa" },
        { login: "tugure-git-intern", role: "admin" },
      ],
    });

    expect(hasil.ok).toBe(true);
    if (hasil.ok) {
      expect(hasil.users).toEqual([
        { login: "maliffadlan", role: "qa" },
        { login: "tugure-git-intern", role: "admin" },
      ]);
      expect(await readFile(hasil.backup, "utf8")).toContain('"maliffadlan": "dev"');
    }
    expect(JSON.parse(await readFile(jalur, "utf8"))).toEqual({
      maliffadlan: "qa",
      "tugure-git-intern": "admin",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ login: "alif", action: "settings-users", target: "users:2", exit: 0 }),
    );
    expect((await readdir(dir)).filter((n) => n.endsWith(".json"))).toHaveLength(1);
  });

  it("revisi basi ditolak 409 dan berkas tidak tersentuh", async () => {
    const { jalur, audit, handler } = await siapkan();
    const lama = await readFile(jalur, "utf8");

    const hasil = await handler.simpan(AKTOR, {
      revisi: "0000000000000000",
      users: [{ login: "alif", role: "admin" }],
    });

    expect(hasil).toMatchObject({ ok: false, status: 409 });
    if (!hasil.ok) expect(hasil.error).toMatch(/muat ulang/i);
    expect(await readFile(jalur, "utf8")).toBe(lama);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ target: "users:revisi-basi", exit: 1 }));
  });

  it("menolak daftar tanpa admin: tidak ada yang bisa membuka Pengaturan lagi", async () => {
    const { jalur, audit, handler } = await siapkan();
    const { revisi } = await handler.baca(AKTOR);
    const lama = await readFile(jalur, "utf8");

    const hasil = await handler.simpan(AKTOR, { revisi, users: [{ login: "alif", role: "qa" }] });

    expect(hasil).toMatchObject({ ok: false, status: 400 });
    if (!hasil.ok) expect(hasil.error).toContain("Minimal satu admin");
    expect(await readFile(jalur, "utf8")).toBe(lama);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ target: "users:tanpa-admin", exit: 1 }));
  });

  it("boleh menurunkan diri sendiri selama masih ada admin lain", async () => {
    const { handler } = await siapkan({ alif: "admin", budi: "admin" });
    const { revisi } = await handler.baca(AKTOR);
    const hasil = await handler.simpan(AKTOR, {
      revisi,
      users: [
        { login: "alif", role: "dev" },
        { login: "budi", role: "admin" },
      ],
    });
    expect(hasil.ok).toBe(true);
  });

  it("login tidak sah ditolak 400 sebelum menyentuh berkas", async () => {
    const { jalur, handler } = await siapkan();
    const { revisi } = await handler.baca(AKTOR);
    const lama = await readFile(jalur, "utf8");

    const hasil = await handler.simpan(AKTOR, {
      revisi,
      users: [
        { login: "tugure-git-intern", role: "admin" },
        { login: "bukan login", role: "dev" },
      ],
    });

    expect(hasil).toMatchObject({ ok: false, status: 400 });
    expect(await readFile(jalur, "utf8")).toBe(lama);
  });
});

describe("settings pengguna: AUTORE_ALLOWED_USERS menimpa berkas", () => {
  it("baca melaporkan sumber env dan tidak bisa diubah; simpan menolak 409", async () => {
    const { jalur, handler } = await siapkan();
    const lama = await readFile(jalur, "utf8");
    vi.stubEnv("AUTORE_ALLOWED_USERS", "tugure-git-intern:admin,alif:dev");
    try {
      const payload = await handler.baca(AKTOR);
      expect(payload.sumber).toBe("env");
      expect(payload.bisaDiubah).toBe(false);
      expect(payload.users).toEqual([
        { login: "alif", role: "dev" },
        { login: "tugure-git-intern", role: "admin" },
      ]);

      const hasil = await handler.simpan(AKTOR, {
        revisi: payload.revisi,
        users: [{ login: "alif", role: "admin" }],
      });
      expect(hasil).toMatchObject({ ok: false, status: 409 });
      if (!hasil.ok) expect(hasil.error).toContain("AUTORE_ALLOWED_USERS");
      expect(await readFile(jalur, "utf8")).toBe(lama);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
