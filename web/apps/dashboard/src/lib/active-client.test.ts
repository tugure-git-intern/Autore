import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchActive } from "./active-client";

const PAYLOAD = {
  generated_at: "2026-11-05T03:40:00Z",
  active: [
    {
      app: "tes-web",
      number: 42,
      status: "running",
      branch: "main",
      commit_sha: "3878d9307475eb84316edde4e77f63fd0b98ae4e",
      author: "Uji <uji@example.test>",
      started_at: "2026-11-05T03:23:08Z",
      url: "http://100.80.3.14:8080/job/tes-web/42",
    },
  ],
  counts: { running: 1, queued: 0 },
};

const response = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchActive", () => {
  it("mengambil /api/active dan mengembalikan payload", async () => {
    const fetchMock = vi.fn(async () => response(true, 200, { data: PAYLOAD, stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    const hasil = await fetchActive();

    expect(fetchMock).toHaveBeenCalledWith("/api/active", { cache: "no-store", signal: undefined });
    expect(hasil.data.active[0]).toMatchObject({ app: "tes-web", status: "running" });
    expect(hasil.data.counts).toEqual({ running: 1, queued: 0 });
    expect(hasil.stale).toBe(false);
  });

  it("meneruskan penanda stale dari server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(true, 200, { data: PAYLOAD, stale: true })));

    expect((await fetchActive()).stale).toBe(true);
  });

  it("melempar error saat respons bukan 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(false, 503, {})));

    await expect(fetchActive()).rejects.toThrow("503");
  });
});
