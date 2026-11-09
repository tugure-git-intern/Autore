import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRuns } from "./runs-client";

const PAYLOAD = {
  generated_at: "2026-11-04T10:00:00Z",
  window_days: 7,
  runs: [
    {
      app: "tes-web",
      number: 9,
      status: "passed",
      duration_ms: 45_555,
      started_at: "2026-11-04T10:06:06Z",
      commit_sha: "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2",
      author: "Autore CLI <autore@tugu-re.com>",
      url: "http://100.80.3.14:8080/job/tes-web/9",
    },
  ],
  daily: [{ date: "2026-11-04", passed: 4, failed: 1 }],
  totals: { passed: 4, failed: 1, running: 0 },
};

const response = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRuns", () => {
  it("mengambil /api/runs dan mengembalikan payload", async () => {
    const fetchMock = vi.fn(async () => response(true, 200, { data: PAYLOAD, stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    const hasil = await fetchRuns();

    expect(fetchMock).toHaveBeenCalledWith("/api/runs", { cache: "no-store", signal: undefined });
    expect(hasil.data.runs).toHaveLength(1);
    expect(hasil.stale).toBe(false);
  });

  it("meneruskan penanda stale dari server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(true, 200, { data: PAYLOAD, stale: true })));

    expect((await fetchRuns()).stale).toBe(true);
  });

  it("melempar error saat respons bukan 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(false, 500, {})));

    await expect(fetchRuns()).rejects.toThrow("500");
  });

  it("menolak payload yang tidak sesuai kontrak", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(true, 200, { data: { ...PAYLOAD, daily: "x" }, stale: false })),
    );

    await expect(fetchRuns()).rejects.toThrow();
  });
});
