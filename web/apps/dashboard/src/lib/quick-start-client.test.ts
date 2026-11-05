import { afterEach, expect, test, vi } from "vitest";
import { STACK, namaSah, runQuickStart } from "./quick-start-client";

type Reply = { ok?: boolean; status?: number; body?: unknown };

function mockFetch(handler: (url: string, init: RequestInit) => Reply) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const reply = handler(String(input), init ?? {});
    return {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      json: async () => reply.body ?? {},
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("mengirim nama yang sudah dirapikan, bahasa, dan pilihan kode ke endpoint quick-start", async () => {
  const fetchMock = mockFetch(() => ({ body: { ok: true, repo: "https://github.com/akun/coba-web" } }));

  const hasil = await runQuickStart({ nama: "  coba-web  ", stack: "nodejs", kode: "contoh" });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/actions/quick-start");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({
    nama: "coba-web",
    stack: "nodejs",
    kode: "contoh",
  });
  expect(hasil.ok).toBe(true);
  expect(hasil.message).toContain("coba-web");
  expect(hasil.repo).toBe("https://github.com/akun/coba-web");
});

test("sukses tanpa URL repo tetap dianggap berhasil, tanpa field repo kosong", async () => {
  mockFetch(() => ({ body: { ok: true } }));

  const hasil = await runQuickStart({ nama: "coba-web", stack: "go", kode: "kosong" });

  expect(hasil).toEqual({ ok: true, message: expect.stringContaining("coba-web") });
});

test("penolakan server memakai pesan error dan baris pertama keluaran CLI", async () => {
  mockFetch(() => ({
    ok: false,
    status: 422,
    body: {
      ok: false,
      status: 422,
      error: "quick-start keluar dengan kode 1",
      output: "ERROR: Token GitHub ditolak (HTTP 401).\nbaris lain",
    },
  }));

  const hasil = await runQuickStart({ nama: "coba-web", stack: "python", kode: "contoh" });

  expect(hasil.ok).toBe(false);
  expect(hasil.message).toContain("quick-start keluar dengan kode 1");
  expect(hasil.message).toContain("Token GitHub ditolak");
  expect(hasil.message).not.toContain("baris lain");
  expect(hasil.redirectTo).toBeUndefined();
});

test("sesi yang ditolak mengarahkan ke /login, bukan cuma pesan", async () => {
  mockFetch(() => ({ ok: false, status: 401, body: { error: "tidak ada sesi" } }));

  const hasil = await runQuickStart({ nama: "coba-web", stack: "python", kode: "contoh" });

  expect(hasil.ok).toBe(false);
  expect(hasil.redirectTo).toBe("/login");
});

test("gagal jaringan jadi pesan yang bisa dibaca, bukan lemparan", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down");
    }),
  );

  const hasil = await runQuickStart({ nama: "coba-web", stack: "java", kode: "contoh" });

  expect(hasil.ok).toBe(false);
  expect(hasil.message).toContain("Gagal menghubungi server");
});

test("namaSah mencerminkan validate_app_name CLI", () => {
  for (const sah of ["a", "coba-web", "aplikasi_1", "x".repeat(63)]) {
    expect(namaSah(sah), sah).toBe(true);
  }
  for (const jahat of ["", " ", "App", "a b", "../x", "-abc", "_abc", "a.b", "x".repeat(64)]) {
    expect(namaSah(jahat), jahat).toBe(false);
  }
  expect(namaSah("  coba-web  ")).toBe(true);
});

test("pilihan bahasa hanya empat stack yang dikenal CLI", () => {
  expect(STACK).toEqual(["python", "nodejs", "java", "go"]);
});
