import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivePayload, RunsPayload } from "@/lib/contracts";
import { OverviewAnalytics } from "./overview-analytics";

const RUNS: RunsPayload = {
  generated_at: "2026-11-05T03:40:00Z",
  window_days: 7,
  runs: [
    {
      app: "tes-web",
      number: 8,
      status: "passed",
      duration_ms: 45_244,
      started_at: "2026-11-05T03:23:08Z",
      commit_sha: "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2",
      author: "Autore CLI <autore@tugu-re.com>",
      url: "http://100.80.3.14:8080/job/tes-web/8",
    },
  ],
  daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, passed: 1, failed: 0 })),
  totals: { passed: 1, failed: 0, running: 0 },
};

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

const response = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const stub = (runs: () => Promise<Response>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/api/active" ? response({ data: ACTIVE, stale: false }) : runs())),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OverviewAnalytics", () => {
  it("menaruh section Active Pipelines di atas grafik Tren 7 Hari", async () => {
    stub(async () => response({ data: RUNS, stale: false }));

    render(<OverviewAnalytics />);

    const judul = (await screen.findAllByRole("heading")).map((h) => h.textContent);
    expect(judul).toContain("Active Pipelines");
    expect(judul).toContain("Tren 7 Hari");
    expect(judul.indexOf("Active Pipelines")).toBeLessThan(judul.indexOf("Tren 7 Hari"));
  });

  it("menampilkan kartu pipeline walau /api/runs gagal", async () => {
    stub(async () => {
      throw new Error("runs mati");
    });

    render(<OverviewAnalytics />);

    expect(await screen.findAllByTestId("pipeline-card")).toHaveLength(1);
    expect(screen.getByText("1 berjalan atau menunggu")).toBeInTheDocument();
  });
});
