import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchAuditLog } from "./audit-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAuditLog", () => {
  it("mengembalikan data dan total dari endpoint /api/audit/log", async () => {
    const fixture = {
      data: [
        {
          ts: "2026-11-08T04:41:55.017Z",
          login: "MAliffadlan",
          email: "maliffadlan@gmail.com",
          action: "deploy",
          target: "java-tes",
          exit: 0,
        },
      ],
      total: 1,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fixture,
    } as Response);

    const hasil = await fetchAuditLog();
    expect(hasil).toEqual(fixture);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/audit/log", expect.objectContaining({
      method: "GET",
      cache: "no-store",
    }));
  });

  it("melempar error jika HTTP status bukan 2xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(fetchAuditLog()).rejects.toThrow("HTTP 500");
  });

  it("menangani data yang tidak berbentuk array dengan fallback aman", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: null, total: null }),
    } as Response);

    const hasil = await fetchAuditLog();
    expect(hasil).toEqual({ data: [], total: 0 });
  });
});
