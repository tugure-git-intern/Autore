import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "@auth/core/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpawnResult } from "./actions";

/**
 * Cookie di sini asli: dibuat `encode()` dari @auth/core dengan salt yang sama
 * seperti dashboard. Yang teruji adalah jalur dekripsi JWE yang sama dengan
 * produksi, bukan versi yang disederhanakan.
 */
const SECRET = randomBytes(40).toString("hex");
const RAHASIA_LAIN = randomBytes(40).toString("hex");

// `encode()` selalu menimpa `exp` dengan `now + maxAge`, jadi kedaluwarsa
// disimulasikan lewat maxAge negatif.
const sesi = (login: string, maxAge = 3600, secret = SECRET) =>
  encode({ token: { login, sub: "1" }, secret, salt: "authjs.session-token", maxAge });

afterEach(() => {
  vi.unstubAllEnvs();
});

async function app(name: string, auth: { secret?: string; allowed?: string[] }) {
  vi.resetModules();
  const { createApp } = await import("./index");
  const { hatchActions } = await import("./actions");
  const dir = await mkdtemp(join(tmpdir(), `autore-sesi-${name}-`));
  await mkdir(join(dir, "tes-web"), { recursive: true });
  const spawn = vi.fn(async (): Promise<SpawnResult> => ({ exitCode: 0, stdout: "lulus", stderr: "" }));
  const app = createApp(
    async () => STATUS,
    hatchActions({ workspace: dir, run: async () => STATUS, spawn, deployApp: "tes-web", bin: "autore" }),
    () => ({ data: RUNS, stale: false }),
    auth,
  );
  return { app, spawn };
}

const STATUS = JSON.stringify({
  system_status: "idle",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 0 },
  repository_health: { score_percent: 0, total_repos: 1, gold: 0, silver: 0, bronze: 1 },
  applications: [
    { id: "tes-web", name: "tes-web", status: "unknown", last_build: "", commit_sha: "", security_issues: 0, deployed: false },
  ],
  latest_pipeline: {
    status: "idle",
    failure_reason: "",
    stages: [],
    security_summary: "",
    commit_sha: "",
    author: "",
    raw_log: [],
  },
});

const RUNS = {
  generated_at: "2026-11-04T10:00:00Z",
  window_days: 7,
  runs: [],
  daily: [],
  totals: { passed: 0, failed: 0, running: 0 },
};

const aksi = (aplikasi: { request: (input: string, init?: RequestInit) => Promise<Response> }, cookie?: string) =>
  aplikasi.request("http://localhost/api/actions/deploy", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });

describe("verifySession", () => {
  it("mengembalikan login dari cookie yang sah", async () => {
    const { verifySession } = await import("./session");
    const cookie = `authjs.session-token=${await sesi("alif")}`;

    expect(await verifySession(new Request("http://localhost/", { headers: { cookie } }), SECRET)).toEqual({
      login: "alif",
    });
  });

  it("menerima cookie ber-prefix __Secure- dengan salt yang ikut berubah", async () => {
    const { verifySession } = await import("./session");
    const nilai = await encode({
      token: { login: "alif", sub: "1" },
      secret: SECRET,
      salt: "__Secure-authjs.session-token",
    });

    const hasil = await verifySession(
      new Request("http://localhost/", { headers: { cookie: `__Secure-authjs.session-token=${nilai}` } }),
      SECRET,
    );

    expect(hasil).toEqual({ login: "alif" });
  });

  it("mengembalikan null tanpa cookie, tanpa login, atau dengan rahasia lain", async () => {
    const { verifySession } = await import("./session");
    const svc = (cookie?: string) =>
      verifySession(new Request("http://localhost/", { headers: cookie ? { cookie } : {} }), SECRET);

    expect(await svc()).toBeNull();
    expect(await svc(`authjs.session-token=${await sesi("alif", 3600, RAHASIA_LAIN)}`)).toBeNull();
    expect(await svc(`authjs.session-token=${await sesi("")}`)).toBeNull();
  });

  it("mengembalikan null untuk token kedaluwarsa", async () => {
    const { verifySession } = await import("./session");

    const hasil = await verifySession(
      new Request("http://localhost/", { headers: { cookie: `authjs.session-token=${await sesi("alif", -60)}` } }),
      SECRET,
    );

    expect(hasil).toBeNull();
  });
});

describe("POST /api/actions/* dengan sesi", () => {
  it("menolak 401 tanpa cookie sesi", async () => {
    const { app: api, spawn } = await app("tanpa-cookie", { secret: SECRET });

    const res = await aksi(api);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, status: 401 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menjalankan aksi saat cookie sah", async () => {
    const { app: api, spawn } = await app("cookie-sah", { secret: SECRET });

    const res = await aksi(api, `authjs.session-token=${await sesi("alif")}`);

    expect(res.status).toBe(200);
    expect(spawn).toHaveBeenCalled();
  });

  it("menolak 401 saat cookie ditandatangani rahasia lain", async () => {
    const { app: api } = await app("rahasia-lain", { secret: SECRET });

    const res = await aksi(api, `authjs.session-token=${await sesi("alif", 3600, RAHASIA_LAIN)}`);

    expect(res.status).toBe(401);
  });

  it("menolak 401 saat sesi kedaluwarsa", async () => {
    const { app: api } = await app("kedaluwarsa", { secret: SECRET });

    const res = await aksi(api, `authjs.session-token=${await sesi("alif", -60)}`);

    expect(res.status).toBe(401);
  });

  it("menolak 403 saat login tidak ada di whitelist API", async () => {
    const { app: api, spawn } = await app("luar-whitelist", { secret: SECRET, allowed: ["tugure-git-intern"] });

    const res = await aksi(api, `authjs.session-token=${await sesi("alif")}`);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, status: 403 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menerima login yang ada di whitelist walau beda huruf besar-kecil", async () => {
    const { app: api } = await app("whitelist-cocok", { secret: SECRET, allowed: ["tugure-git-intern"] });

    const res = await aksi(api, `authjs.session-token=${await sesi("Tugure-Git-Intern")}`);

    expect(res.status).toBe(200);
  });

  it("fail closed 503 saat AUTH_SECRET belum di-set", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    const { app: api, spawn } = await app("tanpa-rahasia", {});

    const res = await aksi(api, `authjs.session-token=${await sesi("alif")}`);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, status: 503 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("tidak menyentuh GET /api/status dan GET /api/runs", async () => {
    const { app: api } = await app("read-only", { secret: SECRET });

    expect((await api.request("http://localhost/api/status")).status).toBe(200);
    expect((await api.request("http://localhost/api/runs")).status).toBe(200);
  });
});
