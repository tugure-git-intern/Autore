import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSbom } from "./sbom-client";

const PAYLOAD = {
  app: "tes-web",
  generated_at: "2026-11-09T04:00:00Z",
  source: "sbom/tes-web.json",
  total: 1,
  packages: [{ name: "zlib1g", version: "1:1.3", type: "os" }],
};

const response = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSbom", () => {
  it("mengambil /api/sbom/:app dan mengembalikan payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(true, 200, PAYLOAD)));

    expect((await fetchSbom("tes-web"))?.packages).toHaveLength(1);
  });

  it("mengembalikan null saat aplikasi belum punya SBOM", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(false, 404, {})));

    expect(await fetchSbom("tes-web")).toBeNull();
  });

  it("menolak payload yang tidak sesuai kontrak", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(true, 200, { ...PAYLOAD, total: 2 })));

    await expect(fetchSbom("tes-web")).rejects.toThrow();
  });
});