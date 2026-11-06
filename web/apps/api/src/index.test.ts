import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "@auth/core/jwt";
import { describe, expect, it, vi } from "vitest";
import type { SpawnAction, SpawnResult } from "./actions";
import { emptyRuns, type RunsPayload } from "./runs";
import { emptyActive, type ActivePayload } from "./active";
import type { SbomResult } from "./sbom";

/**
 * Aksi sekarang butuh sesi. Cookie-nya asli (JWE dari @auth/core) supaya tes
 * guard-rail body tetap lewat middleware auth yang sama dengan produksi.
 */
const TEST_SECRET = randomBytes(40).toString("hex");
let cookieSah: string | undefined;

async function cookie() {
  cookieSah ??= `authjs.session-token=${await encode({
    token: { login: "alif", sub: "1" },
    secret: TEST_SECRET,
    salt: "authjs.session-token",
  })}`;
  return cookieSah;
}

const STATUS = JSON.stringify({
  system_status: "idle",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 0 },
  repository_health: { score_percent: 0, total_repos: 1, gold: 0, silver: 0, bronze: 1 },
  applications: [
    {
      id: "tes-web",
      name: "tes-web",
      status: "unknown",
      last_build: "",
      commit_sha: "",
      security_issues: 0,
      deployed: false,
    },
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

const ok = (): SpawnResult => ({ exitCode: 0, stdout: "lulus", stderr: "" });

/** Satu baris `applications[]` seperti yang ditulis `autore status --json`. */
const appJson = (id: string) => ({
  id,
  name: id,
  status: "unknown",
  last_build: "",
  commit_sha: "",
  security_issues: 0,
  deployed: false,
});

/** Satu kartu berjalan + satu menunggu, seperti kontrak `autore active --json`. */
const ACTIVE: ActivePayload = {
  generated_at: "2026-11-05T03:40:00Z",
  active: [
    {
      app: "tes-web",
      number: 42,
      status: "running",
      branch: "main",
      commit_sha: "3878d9307475eb84316edde4e77f63fd0b98ae4e",
      author: "Uji <uji@example.test>",
      started_at: "2026-11-05T03:23:08Z",
      url: "http://100.80.3.14:8080/job/tes-web/42",
    },
    {
      app: "ui-demo",
      number: 0,
      status: "queued",
      branch: "",
      commit_sha: "",
      author: "",
      started_at: "2026-11-05T03:25:00Z",
      url: "http://100.80.3.14:8080/job/ui-demo",
    },
  ],
  counts: { running: 1, queued: 1 },
};

async function freshApp() {
  vi.resetModules();
  return import("./index");
}

/** Snapshot bentuk baru: `autore status --json` setelah Task 1 (waktu tahap + gerbang). */
const STATUS_DENGAN_TAHAP = JSON.stringify({
  ...JSON.parse(STATUS),
  latest_pipeline: {
    ...JSON.parse(STATUS).latest_pipeline,
    stages: ["checkout", "scan"],
    stage_times: [
      { id: "checkout", at: "2026-11-04T10:01:06Z" },
      { id: "scan", at: "2026-11-04T10:01:12Z" },
    ],
    finished_at: "2026-11-04T10:01:51Z",
    gates_passed: 9,
    gates_total: 9,
  },
});

const RUNS = {
  generated_at: "2026-11-04T10:00:00Z",
  window_days: 7,
  runs: [
    {
      app: "tes-web",
      number: 8,
      status: "passed",
      duration_ms: 46892,
      started_at: "2026-11-04T10:01:06Z",
      commit_sha: "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2",
      author: "Autore CLI <autore@tugu-re.com>",
      url: "http://100.80.3.14:8080/job/tes-web/8",
    },
  ],
  daily: [{ date: "2026-11-04", passed: 3, failed: 2 }],
  totals: { passed: 3, failed: 2, running: 0 },
} satisfies RunsPayload;

/** Aplikasi uji dengan spawn palsu: tidak ada proses nyata yang dijalankan. */
async function testApp(
  spawn: SpawnAction = vi.fn(async () => ok()),
  runs: () => Promise<{ data: RunsPayload; stale: boolean }> = async () => ({
    data: RUNS,
    stale: false,
  }),
  status: string = STATUS,
  active: () => Promise<{ data: ActivePayload; stale: boolean }> = async () => ({
    data: ACTIVE,
    stale: false,
  }),
) {
  const { createApp } = await freshApp();
  const { hatchActions } = await import("./actions");
  const dir = await workspace();
  return createApp(async () => status, hatchActions({
    workspace: dir,
    run: async () => status,
    spawn,
    bin: "autore",
    // Tes tidak boleh menulis ke audit log sungguhan milik mesin ini.
    audit: vi.fn(),
  }), runs, { secret: TEST_SECRET }, active);
}

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "autore-api-"));
  await mkdir(join(dir, "tes-web"), { recursive: true });
  return dir;
}

const post = async (
  app: { request: (input: string, init?: RequestInit) => Promise<Response> },
  path: string,
  body?: unknown,
  raw?: string,
) =>
  app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await cookie() },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

describe("GET /api/sbom/:app", () => {
  const PAYLOAD = {
    app: "tes-web",
    generated_at: "2026-11-05T08:27:11Z",
    source: "/home/tugure/autore-workspace/tes-web/dist/sbom.cdx.json",
    total: 1,
    packages: [{ name: "openssl", version: "3.0.11", type: "os" as const }],
  };

  /** Loader SBOM palsu: tidak ada proses nyata yang dijalankan di tes ini. */
  async function appSbom(sbom: (app: string) => Promise<SbomResult>) {
    const { createApp } = await freshApp();
    const { hatchActions } = await import("./actions");
    const dir = await workspace();
    return createApp(
      async () => STATUS,
      hatchActions({
        workspace: dir,
        run: async () => STATUS,
        spawn: vi.fn(async () => ok()),
        bin: "autore",
      }),
      async () => ({ data: RUNS, stale: false }),
      { secret: TEST_SECRET },
      async () => ({ data: ACTIVE, stale: false }),
      sbom,
    );
  }

  it("mengembalikan payload SBOM apa adanya tanpa menuntut sesi", async () => {
    const app = await appSbom(async (id) => ({
      ok: true,
      status: 200,
      data: { ...PAYLOAD, app: id },
    }));

    const res = await app.request("http://localhost/api/sbom/tes-web");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ...PAYLOAD, app: "tes-web" });
  });

  it("meneruskan alasan gagal dari CLI beserta statusnya", async () => {
    const app = await appSbom(async () => ({
      ok: false,
      status: 404,
      error: "SBOM belum ada untuk `tes-web`",
    }));

    const res = await app.request("http://localhost/api/sbom/tes-web");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "SBOM belum ada untuk `tes-web`" });
  });
});

describe("GET /api/runs", () => {
  it("mengembalikan payload runs beserta penanda stale", async () => {
    const app = await testApp();

    const response = await app.request("http://localhost/api/runs");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ stale: false, data: { window_days: 7 } });
    expect(body.data.runs[0]).toMatchObject({ app: "tes-web", number: 8, status: "passed" });
  });

  it("tetap 200 dengan jendela kosong saat CLI gagal", async () => {
    const app = await testApp(undefined, async () => ({
      data: emptyRuns(Date.parse("2026-11-04T10:00:00Z")),
      stale: true,
    }));

    const response = await app.request("http://localhost/api/runs");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.data.runs).toEqual([]);
    expect(body.data.daily).toHaveLength(7);
  });
});

describe("GET /api/active", () => {
  it("mengembalikan kartu pipeline aktif tanpa memerlukan sesi", async () => {
    const app = await testApp();

    const response = await app.request("http://localhost/api/active");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ stale: false, data: { counts: { running: 1, queued: 1 } } });
    expect(body.data.active[0]).toMatchObject({ app: "tes-web", status: "running", branch: "main" });
    expect(body.data.active[1]).toMatchObject({ app: "ui-demo", status: "queued" });
  });

  it("tetap 200 dengan daftar kosong saat CLI gagal", async () => {
    const app = await testApp(undefined, undefined, undefined, async () => ({
      data: emptyActive(Date.parse("2026-11-05T03:40:00Z")),
      stale: true,
    }));

    const response = await app.request("http://localhost/api/active");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.data.active).toEqual([]);
    expect(body.data.counts).toEqual({ running: 0, queued: 0 });
  });
});

describe("GET /api/status dengan data tahap", () => {
  it("menerima snapshot yang membawa waktu tahap dan jumlah gerbang", async () => {
    const app = await testApp(undefined, undefined, STATUS_DENGAN_TAHAP);

    const response = await app.request("http://localhost/api/status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.latest_pipeline.stage_times).toHaveLength(2);
    expect(body.data.latest_pipeline.finished_at).toBe("2026-11-04T10:01:51Z");
    expect(body.data.latest_pipeline.gates_passed).toBe(9);
    expect(body.data.latest_pipeline.gates_total).toBe(9);
  });

  it("tetap menerima snapshot lama yang belum punya field tahap", async () => {
    const app = await testApp();

    const response = await app.request("http://localhost/api/status");

    expect(response.status).toBe(200);
  });
});

describe("POST /api/actions/scan", () => {
  it("menjalankan scan untuk aplikasi yang diminta", async () => {
    const app = await testApp();

    const response = await post(app, "/api/actions/scan", { app: "tes-web" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ ok: true, action: "scan", target: "tes-web" });
  });

  it("menolak body yang bukan JSON, berkunci ekstra, atau app bukan string", async () => {
    const spawn = vi.fn(async () => ok());
    const app = await testApp(spawn);

    const bad = [
      await post(app, "/api/actions/scan", undefined, "bukan json"),
      await post(app, "/api/actions/scan", { app: "tes-web", extra: 1 }),
      await post(app, "/api/actions/scan", { app: 123 }),
      await post(app, "/api/actions/scan", { app: "" }),
      await post(app, "/api/actions/scan", {}),
      await post(app, "/api/actions/scan", undefined),
    ];

    expect(bad.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menjawab 404 untuk aplikasi yang tidak terdaftar", async () => {
    const app = await testApp();

    const response = await post(app, "/api/actions/scan", { app: "tidak-ada" });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, status: 404 });
  });

  it("menjawab 409 saat aksi lain masih berjalan", async () => {
    let release: () => void = () => {};
    let started: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spawnStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const spawn = vi.fn(async () => {
      started();
      await gate;
      return ok();
    });
    const app = await testApp(spawn);

    const first = post(app, "/api/actions/scan", { app: "tes-web" });
    await spawnStarted;
    const second = await post(app, "/api/actions/deploy", { app: "tes-web" });

    expect(second.status).toBe(409);
    expect((await second.json()).error).toContain("masih berjalan");

    release();
    expect((await first).status).toBe(200);
  });

  it("kegagalan menjalankan CLI jadi 503 tanpa membocorkan objek exception", async () => {
    const spawn = vi.fn(async () => {
      throw Object.assign(new Error("spawn autore ENOENT"), { code: "ENOENT" });
    });
    const app = await testApp(spawn);

    const response = await post(app, "/api/actions/scan", { app: "tes-web" });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(Object.keys(body).sort()).toEqual(["error", "ok", "status"]);
    expect(body.error).not.toContain("at ");
  });
});

describe("POST /api/actions/deploy", () => {
  /** Dua aplikasi nyata di workspace uji, supaya target bisa dibuktikan per id. */
  async function appDuaAplikasi(spawn = vi.fn(async () => ok())) {
    const { createApp } = await freshApp();
    const { hatchActions } = await import("./actions");
    const dir = await mkdtemp(join(tmpdir(), "autore-api-deploy-"));
    for (const id of ["tes-web", "audit-uji3"]) await mkdir(join(dir, id), { recursive: true });
    const status = JSON.stringify({
      ...JSON.parse(STATUS),
      stats: { total_apps: 2, running_containers: 0 },
      repository_health: { score_percent: 0, total_repos: 2, gold: 0, silver: 0, bronze: 2 },
      applications: [appJson("tes-web"), appJson("audit-uji3")],
    });
    const audit = vi.fn();
    const app = createApp(
      async () => status,
      hatchActions({ workspace: dir, run: async () => status, spawn, bin: "autore", audit }),
      undefined,
      { secret: TEST_SECRET },
    );
    return { app, dir, spawn, audit };
  }

  it("men-deploy aplikasi dari body, bukan aplikasi yang dipaku di server", async () => {
    const { app, dir, spawn } = await appDuaAplikasi();

    const response = await post(app, "/api/actions/deploy", { app: "audit-uji3" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: "deploy", target: "audit-uji3" });
    expect(body.target).not.toBe("tes-web");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const [, args] = spawn.mock.calls[0] as [string, string[]];
    // Target dari body; identitas commit dari sesi cookie() — bukan bot `Autore CLI`.
    expect(args).toEqual([
      "deploy",
      "--path",
      join(dir, "audit-uji3"),
      "--author-name",
      "alif",
      "--author-email",
      "alif@users.noreply.github.com",
    ]);
  });

  it("mengikuti id lain di body, jadi targetnya benar-benar dari permintaan", async () => {
    const { app, dir, spawn } = await appDuaAplikasi();

    const response = await post(app, "/api/actions/deploy", { app: "tes-web" });

    expect((await response.json()).target).toBe("tes-web");
    const [, args] = spawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual([
      "deploy",
      "--path",
      join(dir, "tes-web"),
      "--author-name",
      "alif",
      "--author-email",
      "alif@users.noreply.github.com",
    ]);
  });

  it("menolak body tanpa app, body berkunci lain, dan body yang bukan JSON", async () => {
    const spawn = vi.fn(async () => ok());
    const app = await testApp(spawn);

    const tanpa = await post(app, "/api/actions/deploy", undefined);
    const asing = await post(app, "/api/actions/deploy", { app: "tes-web", path: "/etc" });
    const bukanJson = await post(app, "/api/actions/deploy", undefined, "{ini bukan json}");

    expect([tanpa.status, asing.status, bukanJson.status]).toEqual([400, 400, 400]);
    expect((await tanpa.json()).error).toContain("app");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menjawab 503 kalau AUTORE_WORKSPACE belum diset", async () => {
    const { createApp } = await freshApp();
    const { hatchActions } = await import("./actions");
    const app = createApp(async () => STATUS, hatchActions({
      workspace: "",
      run: async () => STATUS,
      spawn: vi.fn(async () => ok()),
      bin: "autore",
    }), undefined, { secret: TEST_SECRET });

    const response = await post(app, "/api/actions/deploy", { app: "tes-web" });

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("AUTORE_WORKSPACE");
  });

  it("mencatat audit dengan identitas dari cookie sesi, bukan dari body", async () => {
    const { app, audit } = await appDuaAplikasi();

    const response = await post(app, "/api/actions/deploy", { app: "tes-web" });

    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ login: "alif", action: "deploy", target: "tes-web" }),
    );
  });

  it("tidak mencatat audit kalau sesi ditolak (401): tak ada aksi yang dijalankan", async () => {
    const { app, audit } = await appDuaAplikasi();

    const response = await app.request("http://localhost/api/actions/deploy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: "tes-web" }),
    });

    expect(response.status).toBe(401);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("POST /api/actions/quick-start", () => {
  const BODY = { nama: "coba-web", stack: "python", kode: "contoh" };

  it("menolak tanpa sesi meski body-nya sah", async () => {
    const spawn = vi.fn(async () => ok());
    const app = await testApp(spawn);

    const res = await app.request("http://localhost/api/actions/quick-start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(401);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("meneruskan permintaan sah ke CLI dan mengembalikan URL repo", async () => {
    const spawn = vi.fn(async () => ({
      exitCode: 0,
      stdout: "  2/4 Repo GitHub akun/coba-web (baru dibuat)\n  3/4 Push ke Git...\n",
      stderr: "",
    }));
    const app = await testApp(spawn);

    const res = await post(app, "/api/actions/quick-start", BODY);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      ok: true,
      status: 200,
      action: "quick-start",
      target: "coba-web",
      repo: "https://github.com/akun/coba-web",
    });
    const [, args] = spawn.mock.calls[0] as [string, string[]];
    expect(args.slice(0, 2)).toEqual(["quick-start", "--path"]);
    // Identitas sesi ikut di ujung argv (audit trail), jadi kode bukan lagi elemen terakhir.
    expect(args).toEqual(
      expect.arrayContaining(["--app-name", "coba-web", "--kode", "contoh", "--author-name", "alif"]),
    );
  });

  it("menolak nama tidak sah dengan 400 tanpa menjalankan proses apa pun", async () => {
    const spawn = vi.fn(async () => ok());
    const app = await testApp(spawn);

    const res = await post(app, "/api/actions/quick-start", { ...BODY, nama: "../rahasia" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("nama aplikasi tidak sah");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menolak stack di luar whitelist dengan 400", async () => {
    const app = await testApp();
    const res = await post(app, "/api/actions/quick-start", { ...BODY, stack: "ruby" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("python");
  });

  it("menolak body yang tidak bisa di-parse", async () => {
    const app = await testApp();
    const res = await post(app, "/api/actions/quick-start", undefined, "{bukan json");

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("body harus JSON");
  });

  it("menolak body lebih besar dari 4 KB sebelum menyentuh spawn", async () => {
    const spawn = vi.fn(async () => ok());
    const app = await testApp(spawn);

    const res = await app.request("http://localhost/api/actions/quick-start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await cookie(),
        "content-length": "5000",
      },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("terlalu besar");
    expect(spawn).not.toHaveBeenCalled();
  });
});
