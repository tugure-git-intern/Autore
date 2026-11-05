import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction } from "./actions-client";

function mockFetch(handler: () => { status: number; body?: unknown; ok?: boolean }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const reply = handler();
      return {
        ok: reply.ok ?? (reply.status >= 200 && reply.status < 300),
        status: reply.status,
        json: async () => reply.body ?? {},
      } as unknown as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAction", () => {
  it("menandai sukses dengan pesan per aksi", async () => {
    mockFetch(() => ({ status: 200, body: { ok: true, action: "deploy", target: "tes-web" } }));

    await expect(runAction("deploy")).resolves.toMatchObject({ ok: true });
    expect((await runAction("deploy")).message).toMatch(/build jenkins/i);
  });

  it("menerjemahkan 401 jadi arahan login ulang", async () => {
    mockFetch(() => ({ status: 401, body: { ok: false, status: 401, error: "Session tidak sah." } }));

    const hasil = await runAction("deploy");

    expect(hasil).toMatchObject({ ok: false, redirectTo: "/login" });
    expect(hasil.message).toMatch(/sesi .*berakhir|login ulang/i);
  });

  it("memperlakukan 403 sama seperti 401: kembali ke login", async () => {
    mockFetch(() => ({ status: 403, body: { ok: false, status: 403, error: "Tidak ada di whitelist." } }));

    expect(await runAction("scan", "tes-web")).toMatchObject({ ok: false, redirectTo: "/login" });
  });

  it("membawa pesan server saat aksinya gagal tanpa menandai redirect", async () => {
    mockFetch(() => ({
      status: 422,
      body: { ok: false, status: 422, error: "aksi scan keluar dengan kode 1", output: "2 temuan HIGH\nlanjut" },
    }));

    const hasil = await runAction("scan", "tes-web");

    expect(hasil.redirectTo).toBeUndefined();
    expect(hasil.message).toBe("aksi scan keluar dengan kode 1 — 2 temuan HIGH");
  });

  it("melaporkan kegagalan jaringan tanpa redirect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const hasil = await runAction("deploy");

    expect(hasil.redirectTo).toBeUndefined();
    expect(hasil.message).toMatch(/gagal menghubungi server/i);
  });
});
