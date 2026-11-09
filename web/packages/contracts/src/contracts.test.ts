import { describe, expect, it } from "vitest";
import {
  isDashboardStatus,
  validateActive,
  validateDashboardStatus,
  validateRuns,
  validateSbomPayload,
} from "./index";

/** Snapshot `autore status --json` yang sah, dipakai sebagai titik tolak tiap tes. */
function snapshot(): Record<string, unknown> {
  return {
    system_status: "idle",
    infra: { jenkins: "active", nexus: "inactive" },
    stats: { total_apps: 3, running_containers: 1 },
    repository_health: { score_percent: 80, total_repos: 6, gold: 2, silver: 3, bronze: 1 },
    applications: [
      {
        id: "demo",
        name: "Demo",
        status: "passed",
        last_build: "2026-11-09T04:00:00Z",
        commit_sha: "abc1234",
        security_issues: 0,
        deployed: true,
        author: "Alif <alif@tugu-re.com>",
      },
    ],
    latest_pipeline: {
      status: "passed",
      failure_reason: "",
      stages: ["1", "2", "3"],
      security_summary: "9/9 gerbang lolos",
      commit_sha: "abc1234",
      author: "Alif",
      raw_log: ["line"],
      gates_passed: 9,
      gates_total: 9,
    },
  };
}

describe("kontrak status", () => {
  it("menerima snapshot lengkap", () => {
    const data = snapshot();
    expect(isDashboardStatus(data)).toBe(true);
    expect(validateDashboardStatus(data)).toBe(data);
  });

  it("menolak snapshot tanpa author pipeline", () => {
    const data = snapshot();
    delete (data.latest_pipeline as Record<string, unknown>).author;
    expect(isDashboardStatus(data)).toBe(false);
    expect(() => validateDashboardStatus(data)).toThrow();
  });

  it("menolak last_build null: CLI mengirim string kosong, bukan null", () => {
    const data = snapshot();
    (data.applications as Array<Record<string, unknown>>)[0].last_build = null;
    expect(isDashboardStatus(data)).toBe(false);
  });

  it("menolak status di luar daftar", () => {
    const data = snapshot();
    data.system_status = "selesai";
    expect(isDashboardStatus(data)).toBe(false);
  });

  it("menolak kunci asing di dalam aplikasi", () => {
    const data = snapshot();
    (data.applications as Array<Record<string, unknown>>)[0].extra = 1;
    expect(isDashboardStatus(data)).toBe(false);
  });

  it("menerima stage_times opsional dan menolak bentuknya yang rusak", () => {
    const sah = snapshot();
    (sah.latest_pipeline as Record<string, unknown>).stage_times = [
      { id: "1", at: "2026-11-09T04:00:00Z" },
    ];
    (sah.latest_pipeline as Record<string, unknown>).started_at = "2026-11-09T04:00:00Z";
    expect(isDashboardStatus(sah)).toBe(true);

    const rusak = snapshot();
    (rusak.latest_pipeline as Record<string, unknown>).stage_times = [{ id: 1 }];
    expect(isDashboardStatus(rusak)).toBe(false);
  });
});

describe("kontrak runs", () => {
  const payload = () => ({
    generated_at: "2026-11-09T04:00:00Z",
    window_days: 7,
    runs: [
      {
        app: "demo",
        number: 12,
        status: "passed",
        duration_ms: 1000,
        started_at: "2026-11-09T04:00:00Z",
        commit_sha: "abc1234",
        author: "Alif",
        url: "http://jenkins/job/demo/12/",
      },
    ],
    daily: [{ date: "2026-11-09", passed: 1, failed: 0 }],
    totals: { passed: 1, failed: 0, running: 0 },
  });

  it("menerima payload sah", () => {
    expect(validateRuns(payload()).runs).toHaveLength(1);
  });

  it("menolak daily yang bukan larik", () => {
    expect(() => validateRuns({ ...payload(), daily: "x" })).toThrow();
  });
});

describe("kontrak active", () => {
  it("menolak number berbentuk string", () => {
    const payload = {
      generated_at: "2026-11-09T04:00:00Z",
      active: [
        {
          app: "demo",
          number: "12",
          status: "running",
          branch: "main",
          commit_sha: "abc1234",
          author: "Alif",
          started_at: "2026-11-09T04:00:00Z",
          url: "http://jenkins/job/demo/12/",
        },
      ],
      counts: { running: 1, queued: 0 },
    };
    expect(() => validateActive(payload)).toThrow();
  });
});

describe("kontrak sbom", () => {
  const payload = () => ({
    app: "demo",
    generated_at: "2026-11-09T04:00:00Z",
    source: "sbom/demo.json",
    total: 1,
    packages: [{ name: "zlib1g", version: "1:1.3", type: "os" }],
  });

  it("menerima payload sah", () => {
    expect(validateSbomPayload(payload()).total).toBe(1);
  });

  it("menolak packages bukan larik dan total yang tidak cocok", () => {
    expect(() => validateSbomPayload({ ...payload(), packages: {} })).toThrow();
    expect(() => validateSbomPayload({ ...payload(), total: 2 })).toThrow();
  });
});