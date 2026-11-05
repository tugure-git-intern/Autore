import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SpawnAction, SpawnResult } from "./actions";
import { hatchSbom, type SbomPayload } from "./sbom";

const APP = "tes-web";

/** Snapshot status minimum yang lolos `loadDashboardStatus`. */
function statusJson(ids: string[]): string {
  return JSON.stringify({
    system_status: "idle",
    infra: { jenkins: "active", nexus: "active" },
    stats: { total_apps: ids.length, running_containers: 0 },
    repository_health: {
      score_percent: 0,
      total_repos: ids.length,
      gold: 0,
      silver: 0,
      bronze: ids.length,
    },
    applications: ids.map((id) => ({
      id,
      name: id,
      status: "unknown",
      last_build: "",
      commit_sha: "",
      security_issues: 0,
    })),
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
}

const PAYLOAD: SbomPayload = {
  app: APP,
  generated_at: "2026-11-05T08:27:11Z",
  source: `/ws/${APP}/dist/sbom.cdx.json`,
  total: 1,
  packages: [{ name: "openssl", version: "3.0.11", type: "os" }],
};

const ok = (stdout: string): SpawnResult => ({ exitCode: 0, stdout, stderr: "" });

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "autore-sbom-"));
  await mkdir(join(dir, APP), { recursive: true });
  return dir;
}

async function make(
  options: { spawn?: SpawnAction; listed?: string[]; workspace?: string; status?: string } = {},
) {
  const dir = options.workspace ?? (await workspace());
  const status = options.status ?? statusJson(options.listed ?? [APP]);
  const spawn = options.spawn ?? vi.fn(async () => ok(JSON.stringify(PAYLOAD)));
  const sbom = hatchSbom({ workspace: dir, run: async () => status, spawn, bin: "autore" });
  return { sbom, spawn: spawn as unknown as ReturnType<typeof vi.fn>, dir };
}

function gagal(pesan: string, kode = "ESPAWN") {
  return vi.fn(async () => {
    throw Object.assign(new Error(pesan), { code: kode });
  });
}

describe("hatchSbom", () => {
  it("memanggil autore sbom dengan argv tetap dan workspace eksplisit", async () => {
    const { sbom, spawn, dir } = await make();

    const hasil = await sbom.get(APP);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, opts] = spawn.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(file).toBe("autore");
    expect(args).toEqual(["sbom", "--app", APP, "--json"]);
    expect(opts.shell).toBe(false);
    expect(opts.cwd).toBe(dir);
    expect((opts.env as NodeJS.ProcessEnv).AUTORE_WORKSPACE).toBe(dir);
    expect(hasil).toEqual({ ok: true, status: 200, data: PAYLOAD });
  });

  it("meneruskan pesan CLI sebagai 404 saat SBOM belum ada", async () => {
    const pesan = "SBOM belum ada untuk `tes-web`: /ws/tes-web/dist/sbom.cdx.json (tidak ada)";
    const { sbom } = await make({
      spawn: vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: pesan })),
    });

    const hasil = await sbom.get(APP);

    expect(hasil.ok).toBe(false);
    expect(hasil).toMatchObject({ status: 404, error: pesan });
  });

  it("menolak id aplikasi yang bisa kabur dari workspace tanpa menjalankan proses", async () => {
    const { sbom, spawn } = await make();

    for (const jahat of ["../rahasia", "a/b", "te s", ""]) {
      const hasil = await sbom.get(jahat);
      expect(hasil).toMatchObject({ ok: false, status: 400 });
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menolak aplikasi yang tidak ada di registry tanpa menjalankan proses", async () => {
    const { sbom, spawn } = await make({ listed: ["tes-web", "ui-demo"] });

    const hasil = await sbom.get("hantu");

    expect(hasil).toMatchObject({ ok: false, status: 404 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menolak registry yang basi", async () => {
    const { sbom, spawn } = await make({ status: "bukan json" });

    const hasil = await sbom.get(APP);

    expect(hasil).toMatchObject({ ok: false, status: 503 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menolak kalau AUTORE_WORKSPACE tidak diset di unit API", async () => {
    const { sbom, spawn } = await make({ workspace: "" });

    const hasil = await sbom.get(APP);

    expect(hasil).toMatchObject({ ok: false, status: 503 });
    expect(hasil.ok === false && hasil.error).toContain("AUTORE_WORKSPACE");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("memisahkan biner hilang (503) dari timeout (504)", async () => {
    const hilang = await make({ spawn: gagal("gagal menjalankan autore", "ENOENT") });
    const telat = await make({ spawn: gagal("autore melewati batas waktu", "ETIMEDOUT") });

    expect(await hilang.sbom.get(APP)).toMatchObject({ ok: false, status: 503 });
    expect(await telat.sbom.get(APP)).toMatchObject({ ok: false, status: 504 });
  });

  it("menolak keluaran CLI yang bukan JSON atau di luar kontrak", async () => {
    const sampah = await make({ spawn: vi.fn(async () => ok("bukan json")) });
    const bentuk_salah = await make({
      spawn: vi.fn(async () => ok(JSON.stringify({ ...PAYLOAD, packages: [{ name: "x" }] }))),
    });
    const total_bohong = await make({
      spawn: vi.fn(async () => ok(JSON.stringify({ ...PAYLOAD, total: 99 }))),
    });

    for (const kasus of [sampah, bentuk_salah, total_bohong]) {
      expect(await kasus.sbom.get(APP)).toMatchObject({ ok: false, status: 422 });
    }
  });
});
