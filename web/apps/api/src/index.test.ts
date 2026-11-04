import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SpawnAction, SpawnResult } from "./actions";

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

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "autore-api-"));
  await mkdir(join(dir, "tes-web"), { recursive: true });
  return dir;
}

/** Aplikasi uji dengan spawn palsu: tidak ada proses nyata yang dijalankan. */
async function testApp(spawn: SpawnAction = vi.fn(async () => ok())) {
  const { createApp } = await freshApp();
  const { hatchActions } = await import("./actions");
  const dir = await workspace();
  return createApp(async () => STATUS, hatchActions({
    workspace: dir,
    run: async () => STATUS,
    spawn,
    deployApp: "tes-web",
    bin: "autore",
  }));
}

const post = (app: { request: (input: string, init?: RequestInit) => Promise<Response> }, path: string, body?: unknown, raw?: string) =>
  app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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
