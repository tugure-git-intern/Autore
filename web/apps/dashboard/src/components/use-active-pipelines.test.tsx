import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivePayload } from "@/lib/contracts";
import { INTERVAL_AKTIF_MS, useActivePipelines } from "./use-active-pipelines";

const PAYLOAD: ActivePayload = {
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

/** Satu microtask flush: cukup untuk janji fetch palsu yang langsung selesai. */
const lancar = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const majukan = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useActivePipelines", () => {
  it("memuat sekali saat mount tanpa menunggu sepuluh detik", async () => {
    const fetchMock = vi.fn(async () => response({ data: PAYLOAD, stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useActivePipelines());
    await lancar();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/active", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(result.current.active).toEqual(PAYLOAD.active);
    expect(result.current.memuat).toBe(false);
  });

  it("memuat lagi setelah sepuluh detik", async () => {
    const fetchMock = vi.fn(async () => response({ data: PAYLOAD, stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useActivePipelines());
    await lancar();
    await majukan(INTERVAL_AKTIF_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tidak menumpuk permintaan yang belum selesai", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useActivePipelines());
    await majukan(3 * INTERVAL_AKTIF_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("berhenti setelah unmount", async () => {
    const fetchMock = vi.fn(async () => response({ data: PAYLOAD, stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderHook(() => useActivePipelines());
    await lancar();
    unmount();
    await majukan(3 * INTERVAL_AKTIF_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gagal setelah sukses tetap menampilkan kartu lama sebagai data terakhir", async () => {
    let rusak = false;
    const fetchMock = vi.fn(async () => {
      if (rusak) throw new Error("api mati");
      return response({ data: PAYLOAD, stale: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useActivePipelines());
    await lancar();
    rusak = true;
    await majukan(INTERVAL_AKTIF_MS);

    expect(result.current.active).toEqual(PAYLOAD.active);
    expect(result.current.stale).toBe(true);
    expect(result.current.memuat).toBe(false);
  });

  it("gagal sejak awal jadi daftar kosong, bukan lemparan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("api mati");
      }),
    );

    const { result } = renderHook(() => useActivePipelines());
    await lancar();

    expect(result.current.active).toEqual([]);
    expect(result.current.counts).toEqual({ running: 0, queued: 0 });
    expect(result.current.stale).toBe(true);
  });

  it("meneruskan penanda stale dari server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: PAYLOAD, stale: true })));

    const { result } = renderHook(() => useActivePipelines());
    await lancar();

    expect(result.current.stale).toBe(true);
  });
});
