import { describe, expect, it } from "vitest";
import type { ApplicationRecord, DashboardStatus, RunRecord, RunsPayload } from "./contracts";
import { hitungSkor } from "./score";

const SEKARANG = Date.parse("2026-11-04T12:00:00Z");

const aplikasi = (id: string): ApplicationRecord => ({
  id,
  name: id,
  status: "passed",
  last_build: "",
  commit_sha: "",
  security_issues: 0,
});

const status = (
  gerbang: { passed?: number; total?: number } = {},
  apps: ApplicationRecord[] = [],
): DashboardStatus => ({
  system_status: "passed",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: apps.length, running_containers: 0 },
  repository_health: { score_percent: 0, total_repos: 0, gold: 0, silver: 0, bronze: 0 },
  applications: apps,
  latest_pipeline: {
    status: "passed",
    failure_reason: "",
    stages: [],
    gates_passed: gerbang.passed,
    gates_total: gerbang.total,
    security_summary: "",
    commit_sha: "",
    author: "",
    raw_log: [],
  },
});

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  app: "tes-web",
  number: 1,
  status: "passed",
  duration_ms: 60_000,
  started_at: "2026-11-04T11:00:00Z",
  commit_sha: "abc1234",
  author: "",
  url: "",
  ...over,
});

function payload(runs: RunRecord[]): RunsPayload {
  const hitung = (status: RunRecord["status"]) => runs.filter((r) => r.status === status).length;
  return {
    generated_at: "",
    window_days: 7,
    runs,
    daily: [],
    totals: { passed: hitung("passed"), failed: hitung("failed"), running: hitung("running") },
  };
}

describe("hitungSkor", () => {
  it("security 9/9 jadi 100 dan 0/0 jadi null", () => {
    expect(hitungSkor(status({ passed: 9, total: 9 }), null, SEKARANG).security).toBe(100);
    expect(hitungSkor(status({ passed: 0, total: 0 }), null, SEKARANG).security).toBeNull();
  });

  it("reliability dari totals runs", () => {
    const runs = [
      ...Array.from({ length: 5 }, () => run()),
      ...Array.from({ length: 5 }, () => run({ status: "failed" })),
    ];

    expect(hitungSkor(status(), payload(runs), SEKARANG).reliability).toBe(50);
  });

  it("speed memakai median dan di-clamp", () => {
    expect(hitungSkor(status(), payload([run({ duration_ms: 60_000 })]), SEKARANG).speed).toBe(50);
    expect(hitungSkor(status(), payload([run({ duration_ms: 300_000 })]), SEKARANG).speed).toBe(0);
    expect(
      hitungSkor(status(), payload([run({ status: "failed", duration_ms: 10_000 })]), SEKARANG).speed,
    ).toBeNull();
  });

  it("speed memakai median, bukan rata-rata", () => {
    const runs = [10_000, 60_000, 200_000].map((durasi, index) =>
      run({ duration_ms: durasi, number: index }),
    );

    expect(hitungSkor(status(), payload(runs), SEKARANG).speed).toBe(50);
  });

  it("freshness menurun seiring umur build", () => {
    const duaBelasJam = run({ started_at: "2026-11-04T00:00:00Z" });

    expect(hitungSkor(status(), payload([duaBelasJam]), SEKARANG).freshness).toBe(50);
  });

  it("coverage menghitung aplikasi yang pernah dibangun", () => {
    const apps = [aplikasi("tes-web"), ...Array.from({ length: 9 }, (_, i) => aplikasi(`app-${i}`))];

    expect(hitungSkor(status({}, apps), payload([run()]), SEKARANG).coverage).toBe(10);
  });

  it("tanpa data sama sekali semua null", () => {
    expect(hitungSkor(status(), null, SEKARANG)).toEqual({
      security: null,
      reliability: null,
      speed: null,
      freshness: null,
      coverage: null,
    });
  });
});