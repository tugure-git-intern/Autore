import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./toast";

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("sukses: role status, teks persis, ikon centang", () => {
    render(<Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={() => {}} />);

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Data berhasil disinkronkan.");
    expect(toast.querySelector("svg.lucide-circle-check")).not.toBeNull();
    expect(toast.className).not.toContain("gradient");
  });

  it("gagal: role alert dan ikon peringatan", () => {
    render(<Toast pesan="Gagal menyinkronkan data." jenis="gagal" onTutup={() => {}} />);

    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Gagal menyinkronkan data.");
    expect(toast.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
  });

  it("menutup sendiri setelah 4 detik", () => {
    vi.useFakeTimers();
    const onTutup = vi.fn();

    render(<Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={onTutup} />);
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onTutup).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onTutup).toHaveBeenCalledTimes(1);
  });

  it("pesan baru me-reset timer, tidak menutup di tengah jalan", () => {
    vi.useFakeTimers();
    const onTutup = vi.fn();

    const { rerender } = render(
      <Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={onTutup} />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(<Toast pesan="Gagal menyinkronkan data." jenis="gagal" onTutup={onTutup} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onTutup).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onTutup).toHaveBeenCalledTimes(1);
  });

  it("unmount menghentikan timer", () => {
    vi.useFakeTimers();
    const onTutup = vi.fn();

    const { unmount } = render(
      <Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={onTutup} />,
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onTutup).not.toHaveBeenCalled();
  });
});
