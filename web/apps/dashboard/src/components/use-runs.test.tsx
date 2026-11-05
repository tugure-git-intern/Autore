import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunsPayload } from "@/lib/contracts";
import { useRuns } from "./use-runs";

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
  daily: [{ date: "2026-11-05", passed: 1, failed: 0 }],
  totals: { passed: 1, failed: 0, running: 0 },
});

const response = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const lancar = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRuns", () => {
  it("memuat sekali saat mount dari /api/runs", async () => {
    const fetchMock = vi.fn(async () => response({ data: runs(8), stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRuns());
    await lancar();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", { cache: "no-store", signal: undefined });
    expect(result.current.hasil?.data.runs[0].number).toBe(8);
    expect(result.current.memuat).toBe(false);
    expect(result.current.gagal).toBe(false);
  });

  it("refresh menukar data dan menjawab true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: runs(8), stale: false }))
      .mockResolvedValueOnce(response({ data: runs(21), stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.hasil?.data.runs[0].number).toBe(8));

    let sukses = false;
    await act(async () => {
      sukses = await result.current.refresh();
    });

    expect(sukses).toBe(true);
    expect(result.current.hasil?.data.runs[0].number).toBe(21);
    expect(result.current.gagal).toBe(false);
  });

  it("gagal menjawab false, bukan melempar, dan data lama tetap tampil", async () => {
    const fetchMock = vi.fn(async () => response({ data: runs(8), stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.hasil).not.toBeNull());

    fetchMock.mockRejectedValueOnce(new Error("runs mati"));
    let sukses = true;
    await act(async () => {
      sukses = await result.current.refresh();
    });

    expect(sukses).toBe(false);
    expect(result.current.gagal).toBe(true);
    expect(result.current.hasil?.data.runs[0].number).toBe(8);
  });

  it("refresh saat permintaan masih jalan berbagi permintaan itu, bukan menambah hit", async () => {
    let lepas: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (lepas = r)));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRuns());
    await lancar();

    let janji: Promise<boolean> | null = null;
    await act(async () => {
      janji = result.current.refresh();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      lepas(response({ data: runs(21), stale: false }));
      await expect(janji).resolves.toBe(true);
    });
  });
});
