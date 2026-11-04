import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SpawnAction, SpawnResult } from "./actions";
import { emptyRuns, type RunsPayload } from "./runs";

const STATUS = JSON.stringify({
  system_status: "idle",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 0 },
  applications: [
    {
      id: "tes-web",
      name: "tes-web",
      status: "unknown",
      last_build: "",
      commit_sha: "",
      security_issues: 0,
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
) {
  const { createApp } = await freshApp();
  const { hatchActions } = await import("./actions");
  const dir = await workspace();
  return createApp(async () => status, hatchActions({
    workspace: dir,
    run: async () => status,
    spawn,
    deployApp: "tes-web",
    bin: "autore",
  }), runs);
}

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "autore-api-"));
  await mkdir(join(dir, "tes-web"), { recursive: true });
  return dir;
}

const post = (app: { request: (input: string, init?: RequestInit) => Promise<Response> }, path: string, body?: unknown, raw?: string) =>
  app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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
    const second = await post(app, "/api/actions/deploy");

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
  it("memakai target dari konfigurasi server, bukan dari body", async () => {
    const app = await testApp();

    const response = await post(app, "/api/actions/deploy", undefined, "{ini bukan json}");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: "deploy", target: "tes-web" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("menjawab 503 kalau target deploy belum dikonfigurasi", async () => {
    const { createApp } = await freshApp();
    const { hatchActions } = await import("./actions");
    const dir = await workspace();
    const app = createApp(async () => STATUS, hatchActions({
      workspace: dir,
      run: async () => STATUS,
      spawn: vi.fn(async () => ok()),
      deployApp: "",
      bin: "autore",
    }));

    const response = await post(app, "/api/actions/deploy");

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("AUTORE_DEPLOY_APP");
  });

  it("menjawab 503 kalau AUTORE_WORKSPACE belum diset", async () => {
    const { createApp } = await freshApp();
    const { hatchActions } = await import("./actions");
    const app = createApp(async () => STATUS, hatchActions({
      workspace: "",
      run: async () => STATUS,
      spawn: vi.fn(async () => ok()),
      deployApp: "tes-web",
      bin: "autore",
    }));

    const response = await post(app, "/api/actions/deploy");

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("AUTORE_WORKSPACE");
  });
});
