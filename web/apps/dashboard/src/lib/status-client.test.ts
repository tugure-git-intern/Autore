import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDashboardStatus } from "./status-client";

const PAYLOAD = {
  system_status: "idle",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 3, running_containers: 1 },
  repository_health: { score_percent: 80, total_repos: 6, gold: 2, silver: 3, bronze: 1 },
  applications: [
    {
      id: "tes-web",
      name: "Tes Web",
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
    stage_times: [{ id: "1", at: "2026-11-09T04:00:00Z" }],
    started_at: "2026-11-09T04:00:00Z",
    security_summary: "9/9 gerbang lolos",
    commit_sha: "abc1234",
    author: "Alif",
    raw_log: ["line"],
    gates_passed: 9,
    gates_total: 9,
  },
};

const response = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDashboardStatus", () => {
  it("mengambil /api/status dan mengembalikan payload", async () => {
    const fetchMock = vi.fn(async () => response(true, 200, { data: PAYLOAD, stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    const hasil = await fetchDashboardStatus();

    expect(fetchMock).toHaveBeenCalledWith("/api/status", { cache: "no-store", signal: undefined });
    expect(hasil.data.applications).toHaveLength(1);
    expect(hasil.stale).toBe(false);
  });

  it("menolak payload yang tidak sesuai kontrak", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(true, 200, { data: { ...PAYLOAD, system_status: "green" }, stale: false }),
      ),
    );

    await expect(fetchDashboardStatus()).rejects.toThrow();
  });

  it("menolak amplop tanpa stale boolean", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(true, 200, { data: PAYLOAD })));

    await expect(fetchDashboardStatus()).rejects.toThrow();
  });
});