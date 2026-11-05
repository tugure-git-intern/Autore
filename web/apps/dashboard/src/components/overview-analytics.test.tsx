import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import type { ActivePayload, ApiStatusResponse, RunsPayload } from "@/lib/contracts";
import type { SessionUser } from "@/lib/current-user";
import { AppShell } from "./app-shell";
import { OverviewAnalytics } from "./overview-analytics";

const USER: SessionUser = { login: "tugure-git-intern", name: "Alif", image: "https://x/a.png" };

const runs = (number: number): RunsPayload => ({
  generated_at: "2026-11-05T03:40:00Z",
  window_days: 7,
  runs: [
    {
      app: "tes-web",
      number,
      status: "passed",
      duration_ms: 45_244,
      started_at: "2026-11-05T03:23:08Z",
      commit_sha: "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2",
      author: "Autore CLI <autore@tugu-re.com>",
      url: `http://100.80.3.14:8080/job/tes-web/${number}`,
    },
  ],
  daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, passed: 1, failed: 0 })),
  totals: { passed: 1, failed: 0, running: 0 },
});

const ACTIVE: ActivePayload = {
  generated_at: "2026-11-05T03:40:00Z",
  active: [
    {
      app: "tes-web",
      number: 42,
      status: "running",
      branch: "main",
      commit_sha: "3878d9307475eb84316edde4e77f63fd0b98ae4e",
      author: "Alif Fadlan <alif@example.test>",
      started_at: "2026-11-05T03:23:08Z",
      url: "http://100.80.3.14:8080/job/tes-web/42",
    },
  ],
  counts: { running: 1, queued: 0 },
};

const STATUS: ApiStatusResponse = {
  data: {
    system_status: "idle",
    infra: { jenkins: "active", nexus: "active" },
    stats: { total_apps: 1, running_containers: 1 },
    repository_health: { score_percent: 10, total_repos: 10, gold: 1, silver: 0, bronze: 9 },
    applications: [],
    latest_pipeline: {
      status: "idle",
      failure_reason: "",
      stages: [],
      security_summary: "",
      commit_sha: "",
      author: "",
      raw_log: [],
    },
  },
  stale: false,
};

const response = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

/**
 * Endpoint palsu. `runs()` dipanggil berurutan supaya tiap tarikan bisa
 * membawa payload berbeda — itu yang membuktikan Sync benar-benar mengubah
 * isi layar, bukan cuma menambah hit.
 */
const stub = (runs: () => Promise<Response>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/status") return response(STATUS);
      if (url === "/api/active") return response({ data: ACTIVE, stale: false });
      return runs();
    }),
  );

const renderAnalytics = () =>
  render(
    <AppShell user={USER}>
      <OverviewAnalytics />
    </AppShell>,
  );

afterEach(() => {
  nav.pathname = "/";
  vi.unstubAllGlobals();
});

describe("OverviewAnalytics", () => {
  it("menaruh section Active Pipelines di atas grafik Tren 7 Hari", async () => {
    stub(async () => response({ data: runs(8), stale: false }));

    renderAnalytics();

    const judul = (await screen.findAllByRole("heading")).map((h) => h.textContent);
    expect(judul).toContain("Active Pipelines");
    expect(judul).toContain("Tren 7 Hari");
    expect(judul.indexOf("Active Pipelines")).toBeLessThan(judul.indexOf("Tren 7 Hari"));
  });

  it("menampilkan kartu pipeline walau /api/runs gagal", async () => {
    stub(async () => {
      throw new Error("runs mati");
    });

    renderAnalytics();

    expect(await screen.findAllByTestId("pipeline-card")).toHaveLength(1);
    expect(screen.getByText("1 berjalan atau menunggu")).toBeInTheDocument();
  });

  it("Sync menukar isi Recent Runs ke payload baru, tanpa reload", async () => {
    let tarikan = 0;
    stub(async () => {
      tarikan += 1;
      return response({ data: runs(tarikan === 1 ? 8 : 21), stale: false });
    });

    renderAnalytics();
    expect(await screen.findByText("tes-web #8")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    expect(await screen.findByText("tes-web #21")).toBeInTheDocument();
    expect(screen.queryByText("tes-web #8")).toBeNull();
  });
});
