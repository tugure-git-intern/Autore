import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { encode } from "next-auth/jwt";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@autore/contracts";
import { createApp } from "./index";
import type { UsersHandler } from "./settings-users";

/**
 * Gerbang HTTP halaman Pengaturan: `/api/settings/users` harus admin untuk GET
 * maupun PUT, menolak body cacat sebelum handler jalan, dan meneruskan 409/400
 * apa adanya. Logika tulisnya sendiri diuji di `settings-users.test.ts`.
 */

const SECRET = randomBytes(40).toString("hex");

async function cookie(login = "alif") {
  return `authjs.session-token=${await encode({
    token: { login, sub: "1" },
    secret: SECRET,
    salt: "authjs.session-token",
  })}`;
}

const ROUTE = "http://localhost/api/settings/users";

async function appDengan(role: Role, handler?: UsersHandler) {
  return createApp(
    undefined,
    undefined,
    undefined,
    {
      secret: SECRET,
      allowed: new Map([["alif", role]]),
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    handler ?? {
      baca: async () => ({ sumber: "berkas" as const, bisaDiubah: true, revisi: "abc", users: [] }),
      simpan: async () => ({ ok: true as const, status: 200 as const, backup: "/tmp/x.bak", users: [] }),
    },
  );
}

const put = (app: ReturnType<typeof createApp>, body: unknown, ck?: string) =>
  app.request(ROUTE, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) },
    body: JSON.stringify(body),
  });

describe("GET /api/settings/users", () => {
  it("admin membaca payload; dev dan qa ditolak 403", async () => {
    const ck = await cookie();
    const admin = await appDengan("admin");
    const res = await admin.request(ROUTE, { headers: { cookie: ck } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sumber: "berkas", bisaDiubah: true, revisi: "abc" });

    for (const role of ["dev", "qa"] as const) {
      const app = await appDengan(role);
      const tolak = await app.request(ROUTE, { headers: { cookie: ck } });
      expect(tolak.status).toBe(403);
    }
  });

  it("tanpa cookie = 401, bukan 403", async () => {
    const app = await appDengan("admin");
    expect((await app.request(ROUTE)).status).toBe(401);
  });
});

describe("PUT /api/settings/users", () => {
  it("admin menyimpan; handler menerima revisi dan daftar apa adanya", async () => {
    const simpan = vi.fn(async () => ({
      ok: true as const,
      status: 200 as const,
      backup: "/tmp/x.bak",
      users: [{ login: "alif", role: "admin" as Role }],
    }));
    const app = await appDengan("admin", {
      baca: async () => ({ sumber: "berkas", bisaDiubah: true, revisi: "abc", users: [] }),
      simpan,
    });

    const res = await put(app, { revisi: "abc", users: [{ login: "alif", role: "admin" }] }, await cookie());
    expect(res.status).toBe(200);
    expect(simpan).toHaveBeenCalledWith(
      expect.objectContaining({ login: "alif" }),
      { revisi: "abc", users: [{ login: "alif", role: "admin" }] },
    );
  });

  it("role di bawah admin ditolak 403 sebelum handler jalan", async () => {
    const simpan = vi.fn();
    for (const role of ["dev", "qa"] as const) {
      const app = await appDengan(role, {
        baca: async () => ({ sumber: "berkas", bisaDiubah: true, revisi: "", users: [] }),
        simpan,
      });
      const res = await put(app, { revisi: "", users: [] }, await cookie());
      expect(res.status).toBe(403);
    }
    expect(simpan).not.toHaveBeenCalled();
  });

  it.each([
    ["tanpa revisi", { users: [] }],
    ["revisi bukan string", { revisi: 1, users: [] }],
    ["users bukan larik", { revisi: "abc", users: {} }],
    ["role asing", { revisi: "abc", users: [{ login: "alif", role: "owner" }] }],
    ["kunci tambahan", { revisi: "abc", users: [], extra: true }],
  ])("menolak body cacat: %s", async (_nama, body) => {
    const simpan = vi.fn();
    const app = await appDengan("admin", {
      baca: async () => ({ sumber: "berkas", bisaDiubah: true, revisi: "abc", users: [] }),
      simpan,
    });
    const res = await put(app, body, await cookie());
    expect(res.status).toBe(400);
    expect(simpan).not.toHaveBeenCalled();
  });

  it("body > 64 KiB ditolak 400 tanpa menyentuh handler", async () => {
    const simpan = vi.fn();
    const app = await appDengan("admin", {
      baca: async () => ({ sumber: "berkas", bisaDiubah: true, revisi: "abc", users: [] }),
      simpan,
    });
    const res = await put(app, { revisi: "abc", users: [], pad: "x".repeat(70 * 1024) }, await cookie());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("terlalu besar") });
    expect(simpan).not.toHaveBeenCalled();
  });

  it("hasil 409 dari handler diteruskan dengan pesan yang sama", async () => {
    const app = await appDengan("admin", {
      baca: async () => ({ sumber: "berkas", bisaDiubah: true, revisi: "abc", users: [] }),
      simpan: async () => ({ ok: false as const, status: 409 as const, error: "Daftar berubah" }),
    });
    const res = await put(app, { revisi: "basi", users: [{ login: "alif", role: "admin" }] }, await cookie());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, status: 409, error: "Daftar berubah" });
  });
});

describe("PUT /api/settings/users terhadap berkas sungguhan", () => {
  it("menulis allowed-users.json di jalur AUTORE_ALLOWLIST_FILE dan menyisakan backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-settings-route-"));
    const jalur = join(dir, "allowed-users.json");
    await writeFile(jalur, JSON.stringify({ alif: "admin" }, null, 2));
    vi.stubEnv("AUTORE_ALLOWLIST_FILE", jalur);
    try {
      const { hatchSettings } = await import("./settings-users");
      const app = await appDengan(
        "admin",
        hatchSettings({ audit: async () => {} }),
      );
      const ck = await cookie();

      const awal = await (await app.request(ROUTE, { headers: { cookie: ck } })).json();
      const res = await put(
        app,
        { revisi: awal.revisi, users: [{ login: "alif", role: "admin" }, { login: "budi", role: "qa" }] },
        ck,
      );

      expect(res.status).toBe(200);
      expect(JSON.parse(await readFile(jalur, "utf8"))).toEqual({ alif: "admin", budi: "qa" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
