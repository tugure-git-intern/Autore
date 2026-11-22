import { afterEach, expect, test, vi } from "vitest";
import { namaRepo, repoSah, runConnect } from "./connect-client";

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

test("hanya URL https github.com yang diterima", () => {
  expect(repoSah("https://github.com/tugure-reasuransi/autore-demo")).toBe(true);
  expect(repoSah("https://github.com/a/b.git")).toBe(true);
  for (const jahat of [
    "https://evil.com/a/b",
    "git@github.com:a/b.git",
    "https://t:tok@github.com/a/b",
    "https://github.com/a/b/../c",
    "https://github.com/a",
    "",
  ]) {
    expect(repoSah(jahat)).toBe(false);
  }
});

test("nama aplikasi bawaan diambil dari nama repo", () => {
  expect(namaRepo("https://github.com/tugure-reasuransi/autore-demo.git")).toBe("autore-demo");
  expect(namaRepo("bukan url")).toBe("");
});

test("mengirim repo, nama, dan branch yang sudah dirapikan ke endpoint connect", async () => {
  const fetchMock = mockFetch(() => ({
    body: { ok: true, repo: "https://github.com/tugure-reasuransi/autore-demo" },
  }));

  const hasil = await runConnect({
    repo: "  https://github.com/tugure-reasuransi/autore-demo.git  ",
    nama: "  demo-saya ",
    branch: "  ",
  });

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/actions/connect");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({
    repo: "https://github.com/tugure-reasuransi/autore-demo.git",
    nama: "demo-saya",
    branch: "main",
  });
  expect(hasil.ok).toBe(true);
  expect(hasil.message).toContain("demo-saya");
  expect(hasil.repo).toBe("https://github.com/tugure-reasuransi/autore-demo");
});

test("peringatan health dari server diteruskan ke pemanggil", async () => {
  mockFetch(() => ({
    body: { ok: true, repo: "https://github.com/tugure-reasuransi/autore-demo", peringatan: "Repo ini belum punya endpoint /health." },
  }));

  const hasil = await runConnect({ repo: "https://github.com/tugure-reasuransi/autore-demo", nama: "autore-demo", branch: "main" });

  expect(hasil.ok).toBe(true);
  expect(hasil.peringatan).toBe("Repo ini belum punya endpoint /health.");
});

test("tanpa peringatan dari server, field peringatan tidak ada", async () => {
  mockFetch(() => ({ body: { ok: true, repo: "https://github.com/tugure-reasuransi/autore-demo" } }));

  const hasil = await runConnect({ repo: "https://github.com/tugure-reasuransi/autore-demo", nama: "autore-demo", branch: "main" });

  expect(hasil.peringatan).toBeUndefined();
});

test("penolakan server memakai pesan error dan baris pertama keluaran CLI", async () => {
  mockFetch(() => ({
    ok: false,
    status: 422,
    body: {
      ok: false,
      status: 422,
      error: "connect keluar dengan kode 1",
      output: "ERROR: Gagal push ke GitHub.\nbaris lain",
    },
  }));

  const hasil = await runConnect({ repo: "https://github.com/a/b", nama: "b", branch: "main" });
  expect(hasil.ok).toBe(false);
  expect(hasil.message).toBe("connect keluar dengan kode 1 — ERROR: Gagal push ke GitHub.");
});

test("baris data @AUTORE disembunyikan, pesan tetap menyebut tahap gagal", async () => {
  mockFetch(() => ({
    ok: false,
    status: 422,
    body: {
      ok: false,
      status: 422,
      error: "connect gagal di tahap jenkins (kode 1)",
      output: [
        '@@AUTORE {"tahap":"kirim","status":"selesai","pesan":"Kode terkirim ke GitHub."}',
        "  4/4 Push GitHub selesai",
        '@@AUTORE {"tahap":"jenkins","status":"gagal","pesan":"Jenkins menolak job."}',
        "ERROR: Jenkins menolak job.",
      ].join("\n"),
    },
  }));

  const hasil = await runConnect({ repo: "https://github.com/a/b", nama: "b", branch: "main" });

  expect(hasil.message).toBe("connect gagal di tahap jenkins (kode 1) — 4/4 Push GitHub selesai");
  expect(hasil.message).not.toContain("@@AUTORE");
});

test("sesi berakhir meminta login ulang, bukan retry diam-diam", async () => {
  mockFetch(() => ({ ok: false, status: 401, body: { error: "sesi tidak sah" } }));

  const hasil = await runConnect({ repo: "https://github.com/a/b", nama: "b", branch: "main" });
  expect(hasil).toMatchObject({ ok: false, redirectTo: "/login" });
});

test("jaringan mati tidak melempar exception ke komponen", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down");
    }),
  );

  const hasil = await runConnect({ repo: "https://github.com/a/b", nama: "b", branch: "main" });
  expect(hasil.ok).toBe(false);
  expect(hasil.message).toContain("Gagal menghubungi server");
});
