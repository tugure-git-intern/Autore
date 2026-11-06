import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

// Hanya `goToLogin` yang dipalsukan: navigasi jsdom tidak bisa dites, sedangkan
// `runAction` tetap asli supaya jalur 401 → redirect teruji end-to-end.
vi.mock("@/lib/actions-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions-client")>();
  return { ...actual, goToLogin: vi.fn() };
});

import { goToLogin } from "@/lib/actions-client";
import { ToastSink } from "@/components/toast";
import { ActionButton } from "./action-button";

const DEPLOY_CONFIRM = {
  title: "Yakin mau deploy?",
  warning:
    "Tindakan ini akan melakukan commit dan push kode lokal Anda ke repository, lalu memicu build Jenkins.",
  confirmLabel: "Ya, deploy",
};

type Reply = { body?: unknown; ok?: boolean; status?: number };

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
  vi.useRealTimers();
});

/**
 * ActionButton tanpa kerangka: hanya sink notifikasi global yang dipasang.
 * Tombol tidak boleh lagi menyimpan pesannya sendiri di dalam baris tabel.
 */
function renderTanpaKerangka(ui: ReactNode) {
  const kirim = vi.fn();
  const { container } = render(<ToastSink.Provider value={kirim}>{ui}</ToastSink.Provider>);
  return { kirim, container };
}

test("menampilkan modal dulu dan tidak memanggil API saat dibatalkan", async () => {
  const fetchMock = mockFetch(() => ({}));
  render(<ActionButton label="Deploy Sekarang" action="deploy" app="tes-web" confirm={DEPLOY_CONFIRM} />);
  const dialog = () => screen.getByText("Yakin mau deploy?").closest("dialog") as HTMLDialogElement;

  // Modal terpasang tapi belum terbuka: klik pertama hanya membuka konfirmasi.
  expect(dialog()).not.toHaveAttribute("open");

  fireEvent.click(screen.getByRole("button", { name: "Deploy Sekarang" }));

  expect(dialog()).toHaveAttribute("open");
  expect(screen.getByText(DEPLOY_CONFIRM.warning)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Batal" }));

  await waitFor(() => expect(dialog()).not.toHaveAttribute("open"));
  expect(fetchMock).not.toHaveBeenCalled();
});

test("memanggil endpoint aksi setelah dikonfirmasi", async () => {
  const fetchMock = mockFetch(() => ({ body: { ok: true, action: "deploy", target: "tes-web" } }));
  render(<ActionButton label="Deploy Sekarang" action="deploy" app="tes-web" confirm={DEPLOY_CONFIRM} />);

  fireEvent.click(screen.getByRole("button", { name: "Deploy Sekarang" }));
  fireEvent.click(screen.getByRole("button", { name: "Ya, deploy" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/actions/deploy");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({ app: "tes-web" });
});

test("tanpa modal, klik langsung menjalankan aksi", async () => {
  const fetchMock = mockFetch(() => ({ body: { ok: true, action: "scan", target: "tes-web" } }));
  render(<ActionButton label="Scan Keamanan" action="scan" app="tes-web" />);

  fireEvent.click(screen.getByRole("button", { name: "Scan Keamanan" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/actions/scan");
  expect(JSON.parse(String(init.body))).toEqual({ app: "tes-web" });
});

test("tombol jadi spinner, tanpa satu pun teks nyempil di bawahnya", async () => {
  let release: (value: unknown) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ),
  );
  const { container } = renderTanpaKerangka(
    <ActionButton label="Scan Keamanan" action="scan" app="tes-web" />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Scan Keamanan" }));

  const button = await screen.findByRole("button", { name: /menjalankan|berjalan/i });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(container.querySelector(".animate-spin")).not.toBeNull();
  // Kemajuan sudah diucapkan aria-busy + label tombol; tidak ada paragraf tambahan.
  expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Menjalankan");
  expect(container.textContent).not.toContain("sedang berjalan");

  release({ ok: true, status: 200, json: async () => ({ ok: true, action: "scan", target: "tes-web" }) });
  await waitFor(() => expect(screen.getByRole("button", { name: "Scan Keamanan" })).toBeEnabled());
});

test("pesan sukses dikirim ke toast global, tidak dirender di dalam baris tabel", async () => {
  mockFetch(() => ({ body: { ok: true, action: "deploy", target: "tes-web" } }));
  const { kirim, container } = renderTanpaKerangka(
    <table>
      <tbody>
        <tr>
          <td>
            <ActionButton label="Deploy Sekarang" action="deploy" app="tes-web" />
          </td>
        </tr>
      </tbody>
    </table>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Deploy Sekarang" }));

  await waitFor(() =>
    expect(kirim).toHaveBeenCalledWith("Deploy terkirim, build Jenkins sedang berjalan.", "sukses"),
  );
  // Satu-satunya isi sel tetap label tombolnya.
  expect(container.querySelector("td")?.textContent).toBe("Deploy Sekarang");
  expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
});

test("pesan gagal dikirim ke toast global dengan jenis gagal dan baris pertama output", async () => {
  mockFetch(() => ({
    ok: false,
    status: 422,
    body: {
      ok: false,
      status: 422,
      error: "aksi scan keluar dengan kode 1",
      output: "[scan] 2 temuan HIGH\nbaris lain",
    },
  }));
  const { kirim, container } = renderTanpaKerangka(
    <ActionButton label="Scan Keamanan" action="scan" app="tes-web" />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Scan Keamanan" }));

  await waitFor(() =>
    expect(kirim).toHaveBeenCalledWith("aksi scan keluar dengan kode 1 — [scan] 2 temuan HIGH", "gagal"),
  );
  expect(container.textContent).toBe("Scan Keamanan");
});

test("memanggil onDone setelah aksi selesai supaya data di-refresh", async () => {
  mockFetch(() => ({ body: { ok: true, action: "scan", target: "tes-web" } }));
  const onDone = vi.fn();
  render(<ActionButton label="Scan Keamanan" action="scan" app="tes-web" onDone={onDone} />);

  fireEvent.click(screen.getByRole("button", { name: "Scan Keamanan" }));

  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
});

test("kegagalan jaringan tetap dilaporkan, bukan diam", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  const { kirim } = renderTanpaKerangka(
    <ActionButton label="Deploy Sekarang" action="deploy" app="tes-web" />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Deploy Sekarang" }));

  await waitFor(() =>
    expect(kirim).toHaveBeenCalledWith(
      "Gagal menghubungi server aksi. Cek jaringan lalu coba lagi.",
      "gagal",
    ),
  );
});

test("sesi ditolak: pesan tampil lalu halaman pindah ke /login", async () => {
  mockFetch(() => ({
    ok: false,
    status: 401,
    body: { ok: false, status: 401, error: "Session tidak sah. Login ulang di dashboard." },
  }));
  vi.mocked(goToLogin).mockClear();
  const { kirim } = renderTanpaKerangka(
    <ActionButton label="Deploy Sekarang" action="deploy" app="tes-web" confirm={DEPLOY_CONFIRM} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Deploy Sekarang" }));
  fireEvent.click(screen.getByRole("button", { name: "Ya, deploy" }));

  await waitFor(() =>
    expect(kirim).toHaveBeenCalledWith("Sesi Anda sudah berakhir. Silakan login ulang.", "gagal"),
  );
  await waitFor(() => expect(vi.mocked(goToLogin)).toHaveBeenCalledWith("/login"));
});

test("scan sukses: pesan 'Scan keamanan selesai tanpa temuan.' tidak menyentuh sel tabel", async () => {
  mockFetch(() => ({ body: { ok: true, action: "scan", target: "tes-web" } }));
  const { kirim, container } = renderTanpaKerangka(
    <table>
      <tbody>
        <tr>
          <td>
            <ActionButton label="Scan Keamanan" action="scan" app="tes-web" />
          </td>
        </tr>
      </tbody>
    </table>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Scan Keamanan" }));

  await waitFor(() =>
    expect(kirim).toHaveBeenCalledWith("Scan keamanan selesai tanpa temuan.", "sukses"),
  );
  expect(screen.queryByText("Scan keamanan selesai tanpa temuan.")).toBeNull();
  expect(container.querySelector("td")?.textContent).toBe("Scan Keamanan");
});