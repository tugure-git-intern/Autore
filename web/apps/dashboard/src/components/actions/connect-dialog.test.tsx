import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

// Hanya `goToLogin` yang dipalsukan (navigasi jsdom tidak bisa dites); `runConnect`
// tetap asli supaya jalur 401 → redirect dan 422 → pesan server ikut teruji.
vi.mock("@/lib/actions-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions-client")>();
  return { ...actual, goToLogin: vi.fn() };
});

import { goToLogin } from "@/lib/actions-client";
import { ConnectDialog } from "./connect-dialog";
import { QuickStartDialog } from "./quick-start-dialog";

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
  vi.clearAllMocks();
});

const REPO = "https://github.com/tugure-reasuransi/autore-demo";

function buka() {
  fireEvent.click(screen.getByRole("button", { name: /Sambungkan Repo/ }));
}

function sampaiKonfirmasi() {
  fireEvent.change(screen.getByLabelText("URL Repo GitHub"), { target: { value: REPO } });
  fireEvent.click(screen.getByRole("button", { name: "Lanjut" }));
}

test("dialog tertutup sebelum tombol diklik", () => {
  mockFetch(() => ({}));
  render(<ConnectDialog />);
  expect(document.querySelector("dialog")).not.toHaveAttribute("open");
});

test("Lanjut mati sampai URL repo sah; nama aplikasi terisi otomatis dari nama repo", () => {
  mockFetch(() => ({}));
  render(<ConnectDialog />);
  buka();

  const lanjut = screen.getByRole("button", { name: "Lanjut" });
  expect(lanjut).toBeDisabled();

  const repo = screen.getByLabelText("URL Repo GitHub");
  fireEvent.change(repo, { target: { value: "git@github.com:a/b.git" } });
  expect(lanjut).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("https://github.com/");

  fireEvent.change(repo, { target: { value: REPO } });
  expect((screen.getByLabelText("Nama Aplikasi") as HTMLInputElement).value).toBe("autore-demo");
  expect(lanjut).toBeEnabled();
});

test("nama aplikasi tetap milik dev setelah diubah manual", () => {
  mockFetch(() => ({}));
  render(<ConnectDialog />);
  buka();

  fireEvent.change(screen.getByLabelText("Nama Aplikasi"), { target: { value: "demo-saya" } });
  fireEvent.change(screen.getByLabelText("URL Repo GitHub"), { target: { value: REPO } });
  expect((screen.getByLabelText("Nama Aplikasi") as HTMLInputElement).value).toBe("demo-saya");
});

test("konfirmasi wajib mengetik nama aplikasi sebelum tombol kirim aktif", () => {
  mockFetch(() => ({}));
  render(<ConnectDialog />);
  buka();
  sampaiKonfirmasi();

  const kirim = screen.getByRole("button", { name: "Sambungkan Sekarang" });
  expect(kirim).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("mengirim commit");

  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "salah" },
  });
  expect(kirim).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "autore-demo" },
  });
  expect(kirim).toBeEnabled();
});

test("sukses mengirim repo/nama/branch ke API lalu menutup dialog dan memuat ulang daftar", async () => {
  const fetchMock = mockFetch(() => ({ body: { ok: true, repo: REPO } }));
  const onSelesai = vi.fn();
  render(<ConnectDialog onSelesai={onSelesai} />);
  buka();
  sampaiKonfirmasi();
  // Branch ada di langkah 1: kembali dulu untuk mengubahnya.
  fireEvent.click(screen.getByRole("button", { name: "Kembali" }));
  fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "master" } });
  fireEvent.click(screen.getByRole("button", { name: "Lanjut" }));
  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "autore-demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sambungkan Sekarang" }));

  await waitFor(() => expect(onSelesai).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/actions/connect");
  expect(JSON.parse(String(init.body))).toEqual({
    repo: REPO,
    nama: "autore-demo",
    branch: "master",
  });
  expect(document.querySelector("dialog")).not.toHaveAttribute("open");
});

test("penolakan server ditampilkan apa adanya dan dialog tetap terbuka", async () => {
  mockFetch(() => ({
    ok: false,
    status: 422,
    body: { ok: false, status: 422, error: "connect keluar dengan kode 1", output: "ERROR: Gagal push ke GitHub." },
  }));
  render(<ConnectDialog />);
  buka();
  sampaiKonfirmasi();
  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "autore-demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sambungkan Sekarang" }));

  await waitFor(() =>
    expect(screen.getByText(/ERROR: Gagal push ke GitHub\./)).toBeInTheDocument(),
  );
  expect(document.querySelector("dialog")).toHaveAttribute("open");
});

test("sesi berakhir dialihkan ke halaman login", async () => {
  mockFetch(() => ({ ok: false, status: 401, body: { error: "sesi tidak sah" } }));
  render(<ConnectDialog />);
  buka();
  sampaiKonfirmasi();
  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "autore-demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sambungkan Sekarang" }));

  await waitFor(() => expect(goToLogin).toHaveBeenCalledWith("/login"));
});

// Dua dialog hidup berdampingan di /applications. Isi dialog tertutup tidak boleh
// ikut ke pohon aksesibilitas: label kembar membuat locator `getByLabel("Nama Aplikasi")`
// ambigu (Playwright strict mode) dan pembaca layar menyebut field yang tidak terlihat.
test("dialog tertutup tidak menyumbang label saat dua dialog dipasang bersamaan", () => {
  mockFetch(() => ({}));
  render(
    <>
      <ConnectDialog />
      <QuickStartDialog />
    </>,
  );
  expect(screen.queryAllByLabelText("Nama Aplikasi")).toHaveLength(0);

  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));
  expect(screen.queryAllByLabelText("Nama Aplikasi")).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Batal" }));
  fireEvent.click(screen.getByRole("button", { name: /Sambungkan Repo/ }));
  expect(screen.queryAllByLabelText("Nama Aplikasi")).toHaveLength(1);
});
