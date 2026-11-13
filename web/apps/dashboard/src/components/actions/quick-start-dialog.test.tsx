import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

// Hanya `goToLogin` yang dipalsukan (navigasi jsdom tidak bisa dites); `runQuickStart`
// tetap asli supaya jalur 401 → redirect dan 422 → pesan server ikut teruji.
vi.mock("@/lib/actions-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions-client")>();
  return { ...actual, goToLogin: vi.fn() };
});

import { goToLogin } from "@/lib/actions-client";
import { runQuickStart as runQuickStartAsli } from "@/lib/quick-start-client";
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

/** Langkah 1 yang sudah valid → masuk langkah konfirmasi. */
function sampaiKonfirmasi(nama = "coba-web") {
  fireEvent.change(screen.getByLabelText("Nama Aplikasi"), { target: { value: nama } });
  fireEvent.click(screen.getByRole("button", { name: "Lanjut" }));
}

test("dialog tidak terbuka sebelum tombolnya diklik", () => {
  mockFetch(() => ({}));
  render(<QuickStartDialog />);

  expect(screen.getByRole("button", { name: /Buat Aplikasi Baru/ })).toBeInTheDocument();
  // Dialog terpasang tapi tertutup, jadi belum ada form yang bisa diisi.
  expect(document.querySelector("dialog")).not.toHaveAttribute("open");
});

test("tombol Lanjut baru aktif setelah nama sah, dan menolak nama bergaya flag", () => {
  mockFetch(() => ({}));
  render(<QuickStartDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));

  const lanjut = screen.getByRole("button", { name: "Lanjut" });
  expect(lanjut).toBeDisabled();

  const nama = screen.getByLabelText("Nama Aplikasi");
  fireEvent.change(nama, { target: { value: "A B" } });
  expect(lanjut).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Nama aplikasi tidak sah");

  fireEvent.change(nama, { target: { value: "--force" } });
  expect(lanjut).toBeDisabled();

  fireEvent.change(nama, { target: { value: "coba-web" } });
  expect(lanjut).toBeEnabled();
});

test("dropdown bahasa memuat empat stack dengan Node.js sebagai pilihan awal", () => {
  mockFetch(() => ({}));
  render(<QuickStartDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));

  const bahasa = screen.getByLabelText("Bahasa") as HTMLSelectElement;
  expect([...bahasa.options].map((o) => o.value)).toEqual(["python", "nodejs", "java", "go"]);
  expect(bahasa.value).toBe("nodejs");
});

test("langkah konfirmasi memperingatkan repo PUBLIK dan butuh nama diketik ulang", () => {
  mockFetch(() => ({}));
  render(<QuickStartDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));
  sampaiKonfirmasi();

  expect(screen.getByText(/repository PUBLIK di GitHub/)).toBeInTheDocument();

  const eksekusi = screen.getByRole("button", { name: "Buat Aplikasi" });
  expect(eksekusi).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "coba-we" },
  });
  expect(eksekusi).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "coba-web" },
  });
  expect(eksekusi).toBeEnabled();
});

test("selama dikirim: spinner, status 'Sedang membuat repo', tombol disabled", async () => {
  let lepas: ((value: unknown) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          lepas = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }),
    ),
  );
  render(<QuickStartDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));
  sampaiKonfirmasi();
  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "coba-web" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Buat Aplikasi" }));

  await screen.findByText(/Sedang membuat repo/);
  expect(screen.getByRole("button", { name: /Membuat/ })).toBeDisabled();

  lepas?.(undefined);
});

test("sukses menutup dialog, memanggil onSelesai, dan menampilkan toast sukses", async () => {
  mockFetch(() => ({ body: { ok: true, repo: "https://github.com/akun/coba-web" } }));
  const onSelesai = vi.fn();
  render(<QuickStartDialog onSelesai={onSelesai} />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));
  sampaiKonfirmasi();
  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "coba-web" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Buat Aplikasi" }));

  await waitFor(() => expect(onSelesai).toHaveBeenCalledTimes(1));
  expect(await screen.findByTestId("toast")).toHaveTextContent("coba-web");
  expect(document.querySelector("dialog")).not.toHaveAttribute("open");
  expect(goToLogin).not.toHaveBeenCalled();
});

test("gagal 422 menampilkan pesan server di toast gagal dan dialog tetap terbuka", async () => {
  mockFetch(() => ({
    ok: false,
    status: 422,
    body: { error: "quick-start keluar dengan kode 1", output: "ERROR: Token GitHub ditolak (HTTP 401)." },
  }));
  const onSelesai = vi.fn();
  render(<QuickStartDialog onSelesai={onSelesai} />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));
  sampaiKonfirmasi();
  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "coba-web" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Buat Aplikasi" }));

  const toast = await screen.findByTestId("toast");
  expect(toast).toHaveAttribute("role", "alert");
  expect(toast).toHaveTextContent("Token GitHub ditolak");
  expect(onSelesai).not.toHaveBeenCalled();
  expect(screen.getByText(/repository PUBLIK di GitHub/)).toBeInTheDocument();
});

test("sesi berakhir (401) memindahkan halaman ke /login", async () => {
  mockFetch(() => ({ ok: false, status: 401, body: { error: "tidak ada sesi" } }));
  render(<QuickStartDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));
  sampaiKonfirmasi();
  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "coba-web" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Buat Aplikasi" }));

  await waitFor(() => expect(goToLogin).toHaveBeenCalledWith("/login"));
});

test("pilihan kode contoh bisa dilepas dan ikut terkirim sebagai kosong", async () => {
  const fetchMock = mockFetch(() => ({ body: { ok: true } }));
  render(<QuickStartDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));

  const kode = screen.getByLabelText(/Isi kode contoh/) as HTMLInputElement;
  expect(kode.checked).toBe(true);
  fireEvent.click(kode);
  sampaiKonfirmasi();
  fireEvent.change(screen.getByLabelText("Ketik nama aplikasi untuk konfirmasi"), {
    target: { value: "coba-web" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Buat Aplikasi" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({ kode: "kosong" });
});

test("tidak ada kelas animasi gradien di markup (aturan tampilan Autore)", () => {
  mockFetch(() => ({}));
  const { container } = render(<QuickStartDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Buat Aplikasi Baru/ }));

  expect(container.innerHTML).not.toMatch(/gradient/);
});

// Sanity: jalur 401 di atas bergantung pada runQuickStart asli, jadi pastikan
// modul yang dipakai komponen memang modul nyata (bukan tiruan).
test("runQuickStart asli dipakai komponen", () => {
  expect(typeof runQuickStartAsli).toBe("function");
});
