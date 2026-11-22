import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";
import * as client from "@/lib/settings-client";

/**
 * Halaman Pengaturan: hanya kerangka + perilaku yang terlihat admin — 403
 * dirender sebagai kartu tolak, sumber env mematikan Simpan, dan pesan 409 dari
 * server tampil apa adanya. Aturan tulis ada di `apps/api/src/settings-users.test.ts`.
 */

const BERKAS = {
  sumber: "berkas" as const,
  bisaDiubah: true,
  revisi: "abc123",
  users: [
    { login: "alif", role: "admin" as const },
    { login: "budi", role: "dev" as const },
  ],
};

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("menampilkan daftar pengguna dan role-nya", async () => {
    vi.spyOn(client, "fetchUsers").mockResolvedValueOnce(BERKAS);
    render(<SettingsPage />);

    expect(screen.getByRole("heading", { name: /Pengguna & Role/ })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("alif")).toBeTruthy();
      expect(screen.getByText("budi")).toBeTruthy();
    });
    expect(screen.getByLabelText("Role untuk alif")).toHaveProperty("value", "admin");
  });

  it("403 dirender sebagai kartu akses ditolak, bukan tabel kosong", async () => {
    vi.spyOn(client, "fetchUsers").mockRejectedValueOnce(new client.GalatPengaturan("Halaman ini hanya untuk admin.", 403));
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText(/Akses ditolak/)).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("sumber env: peringatan tampil dan Simpan mati", async () => {
    vi.spyOn(client, "fetchUsers").mockResolvedValueOnce({ ...BERKAS, sumber: "env", bisaDiubah: false });
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText(/AUTORE_ALLOWED_USERS/)).toBeTruthy());
    const simpan = screen.getByRole("button", { name: "Simpan" });
    fireEvent.click(screen.getByLabelText("Login GitHub baru"));
    expect(simpan).toHaveProperty("disabled", true);
  });

  it("Simpan mengirim daftar hasil suntingan, bukan salinan awal", async () => {
    vi.spyOn(client, "fetchUsers").mockResolvedValue(BERKAS);
    const simpan = vi.spyOn(client, "simpanUsers").mockResolvedValueOnce({ backup: "/x/allowed-users.json.bak-1" });
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("Role untuk budi")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Role untuk budi"), { target: { value: "qa" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() =>
      expect(simpan).toHaveBeenCalledWith({
        revisi: "abc123",
        users: [
          { login: "alif", role: "admin" },
          { login: "budi", role: "qa" },
        ],
      }),
    );
  });

  it("login baru dinormalkan ke huruf kecil dan tidak bisa ganda", async () => {
    vi.spyOn(client, "fetchUsers").mockResolvedValue(BERKAS);
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("Login GitHub baru")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Login GitHub baru"), { target: { value: "  Budi " } });
    fireEvent.click(screen.getByRole("button", { name: "Tambah" }));
    // "budi" sudah ada: tidak ada baris kedua.
    expect(screen.getAllByLabelText(/Role untuk/)).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Login GitHub baru"), { target: { value: " Citra " } });
    fireEvent.click(screen.getByRole("button", { name: "Tambah" }));
    await waitFor(() => expect(screen.getByText("citra")).toBeTruthy());
    expect(screen.getAllByLabelText(/Role untuk/)).toHaveLength(3);
  });

  it("409 dari server ditampilkan apa adanya lewat toast lalu daftar dimuat ulang", async () => {
    vi.spyOn(client, "fetchUsers").mockResolvedValue(BERKAS);
    vi.spyOn(client, "simpanUsers").mockRejectedValueOnce(
      new client.GalatPengaturan("Daftar berubah sejak dibuka; muat ulang lalu ulangi.", 409),
    );
    const { ToastSink } = await import("@/components/toast");
    const kirim = vi.fn();
    render(
      <ToastSink.Provider value={kirim}>
        <SettingsPage />
      </ToastSink.Provider>,
    );

    await waitFor(() => expect(screen.getByLabelText("Role untuk budi")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Role untuk budi"), { target: { value: "qa" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() =>
      expect(kirim).toHaveBeenCalledWith("Daftar berubah sejak dibuka; muat ulang lalu ulangi.", "gagal"),
    );
  });
});
