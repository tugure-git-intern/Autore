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
  const spawn = vi.fn(
    async (_file: string, _args: string[], _options: unknown): Promise<SpawnResult> => ({
      exitCode: 0,
      stdout: "lulus",
      stderr: "",
    }),
  );
  const app = createApp(
    async () => STATUS,
    hatchActions({ workspace: dir, run: async () => STATUS, spawn, bin: "autore" }),
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

/** Cookie dengan nama & email seperti token GitHub sungguhan. */
const sesiGithub = (nama: string | null, email: string | null) =>
  encode({
    token: { login: "MAliffadlan", name: nama, email, sub: "7" },
    secret: SECRET,
    salt: "authjs.session-token",
  });

const aksi = (aplikasi: { request: (input: string, init?: RequestInit) => Promise<Response> }, cookie?: string) =>
  aplikasi.request("http://localhost/api/actions/deploy", {
    method: "POST",
    // Deploy selalu menunjuk aplikasi yang diminta, jadi helper sesi pun mengirim body.
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ app: "tes-web" }),
  });

describe("identitasDariToken", () => {
  it("memakai name & email dari token apa adanya", async () => {
    const { identitasDariToken } = await import("./session");

    expect(
      identitasDariToken({ login: "MAliffadlan", name: "Alif Fadlan", email: "alif@example.com" }),
    ).toEqual({ login: "MAliffadlan", nama: "Alif Fadlan", email: "alif@example.com" });
  });

  it("email null (privat di GitHub) jatuh ke noreply login", async () => {
    const { identitasDariToken } = await import("./session");

    expect(identitasDariToken({ login: "MAliffadlan", name: "Alif Fadlan", email: null }).email).toBe(
      "maliffadlan@users.noreply.github.com",
    );
    expect(identitasDariToken({ login: "MAliffadlan", name: null, email: "" }).email).toBe(
      "maliffadlan@users.noreply.github.com",
    );
  });

  it("nama kosong jatuh ke login, jadi author tidak pernah kosong", async () => {
    const { identitasDariToken } = await import("./session");

    expect(identitasDariToken({ login: "MAliffadlan", name: "   ", email: null }).nama).toBe("MAliffadlan");
  });

  it("nama tampilan yang hanya beda casing dari login tidak menutupi login", async () => {
    const { identitasDariToken } = await import("./session");

    // Kasus nyata: profil GitHub `MAliffadlan` mengisi Name dengan "maliffadlan".
    // Nama itu tidak membawa informasi baru, sedangkan login menunjuk akunnya.
    expect(identitasDariToken({ login: "MAliffadlan", name: "maliffadlan", email: null }).nama).toBe(
      "MAliffadlan",
    );
    expect(identitasDariToken({ login: "MAliffadlan", name: "  MALIFFADLAN ", email: null }).nama).toBe(
      "MAliffadlan",
    );
  });

  it("nama tampilan yang membawa informasi lain tetap dipakai apa adanya", async () => {
    const { identitasDariToken } = await import("./session");

    expect(
      identitasDariToken({ login: "MAliffadlan", name: "Muhammad Alif Fadlan", email: null }).nama,
    ).toBe("Muhammad Alif Fadlan");
  });

  it("membuang karakter kontrol dan memotong nama yang kepanjangan", async () => {
    const { identitasDariToken } = await import("./session");
    const hasil = identitasDariToken({
      login: "alif",
      name: `Alif\n[user]\n\tevil = 1 ${"x".repeat(200)}`,
      email: null,
    });

    expect(hasil.nama).not.toContain("\n");
    expect(hasil.nama.split("").every((c) => c.codePointAt(0)! >= 32)).toBe(true);
    expect(hasil.nama.length).toBeLessThanOrEqual(100);
  });

  it("menolak email yang bukan alamat polos", async () => {
    const { identitasDariToken } = await import("./session");

    for (const jahat of ["bukan-email", "a@b c", "x@y<z>", "a@@b.com"]) {
      expect(identitasDariToken({ login: "alif", name: "Alif", email: jahat }).email).toBe(
        "alif@users.noreply.github.com",
      );
    }
  });

  it("tanpa login tidak ada identitas (null, bukan author kosong)", async () => {
    const { identitasDariToken } = await import("./session");

    expect(identitasDariToken({ login: "", name: "Tanpa Login" })).toBeNull();
    expect(identitasDariToken(null)).toBeNull();
  });
});

describe("verifySession", () => {
  it("mengembalikan login dari cookie yang sah", async () => {
    const { verifySession } = await import("./session");
    const cookie = `authjs.session-token=${await sesi("alif")}`;

    // Token tanpa name/email: nama jatuh ke login, email jatuh ke noreply GitHub.
    expect(await verifySession(new Request("http://localhost/", { headers: { cookie } }), SECRET)).toEqual({
      login: "alif",
      nama: "alif",
      email: "alif@users.noreply.github.com",
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

    expect(hasil).toMatchObject({ login: "alif" });
  });

  it("membawa nama dan email GitHub dari token, bukan hanya login", async () => {
    const { verifySession } = await import("./session");
    const cookie = `authjs.session-token=${await sesiGithub("Alif Fadlan", "alif@example.com")}`;

    expect(await verifySession(new Request("http://localhost/", { headers: { cookie } }), SECRET)).toEqual({
      login: "MAliffadlan",
      nama: "Alif Fadlan",
      email: "alif@example.com",
    });
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

  it("meneruskan identitas sesi ke argv quick-start (audit trail)", async () => {
    const { app: api, spawn } = await app("identitas-quick-start", { secret: SECRET });
    const cookie = `authjs.session-token=${await sesiGithub("Alif Fadlan", "alif@example.com")}`;

    const res = await api.request("http://localhost/api/actions/quick-start", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ nama: "audit-uji", stack: "python", kode: "contoh" }),
    });
    const args = spawn.mock.calls[0][1];

    expect(res.status).toBe(200);
    expect(args).toEqual(
      expect.arrayContaining(["--author-name", "Alif Fadlan", "--author-email", "alif@example.com"]),
    );
  });

  it("meneruskan identitas sesi ke argv deploy (audit trail)", async () => {
    const { app: api, spawn } = await app("identitas-deploy", { secret: SECRET });
    const cookie = `authjs.session-token=${await sesiGithub("Alif Fadlan", "alif@example.com")}`;

    const res = await aksi(api, cookie);
    const args = spawn.mock.calls[0][1];

    expect(res.status).toBe(200);
    expect(args).toEqual(
      expect.arrayContaining([
        "deploy",
        "--author-name",
        "Alif Fadlan",
        "--author-email",
        "alif@example.com",
      ]),
    );
  });

  it("menolak 400 body yang mencoba mengirim identitas sendiri", async () => {
    const { app: api, spawn } = await app("identitas-palsu", { secret: SECRET });

    const res = await api.request("http://localhost/api/actions/quick-start", {
      method: "POST",
      headers: {
        cookie: `authjs.session-token=${await sesiGithub("Alif Fadlan", "alif@example.com")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ nama: "audit-uji", stack: "python", author: { nama: "Penyerang" } }),
    });

    expect(res.status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });
});
