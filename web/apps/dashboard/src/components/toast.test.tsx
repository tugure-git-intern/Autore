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

  it("menutup sendiri setelah 4 detik tayang, lalu animasi turun selesai", () => {
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
    expect(onTutup).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(239);
    });
    expect(onTutup).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onTutup).toHaveBeenCalledTimes(1);
  });

  it("mengambang di tengah bawah", () => {
    render(<Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={() => {}} />);

    const toast = screen.getByRole("status").className;
    expect(toast).toContain("fixed bottom-6 left-0 right-0");
    expect(toast).toContain("mx-auto w-fit");
    expect(toast).toContain("shadow-lg");
  });

  it("naik dari bawah, diam, lalu turun sebelum benar-benar hilang", () => {
    vi.useFakeTimers();

    render(<Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={() => {}} />);

    const toast = screen.getByTestId("toast");
    expect(toast.className).toContain("motion-safe:animate-[toast-naik_240ms_cubic-bezier(.22,1,.36,1)_both]");
    expect(toast.dataset.keluar).toBe("false");

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    // Masih di layar: sedang turun, belum dilepas pemanggil.
    expect(screen.getByTestId("toast").className).toContain(
      "motion-safe:animate-[toast-turun_240ms_ease-in_both]",
    );
    expect(screen.getByTestId("toast").dataset.keluar).toBe("true");
    expect(screen.getByText("Data berhasil disinkronkan.")).toBeInTheDocument();
  });

  it("pesan baru di tengah animasi turun mengembalikan toast ke posisi naik", () => {
    vi.useFakeTimers();
    const onTutup = vi.fn();

    const { rerender } = render(<Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={onTutup} />);
    act(() => {
      vi.advanceTimersByTime(4_100);
    });
    expect(screen.getByTestId("toast").dataset.keluar).toBe("true");

    rerender(<Toast pesan="Gagal menyinkronkan data." jenis="gagal" onTutup={onTutup} />);

    expect(screen.getByTestId("toast").dataset.keluar).toBe("false");
    act(() => {
      vi.advanceTimersByTime(4_100);
    });
    expect(onTutup).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(140);
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

    // 4 detik tayang penuh sejak pesan baru + 240 ms animasi turun.
    act(() => {
      vi.advanceTimersByTime(1240);
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

  it("permukaan navy gelap ala Google Cloud: teks terang, ikon bertinta jenis", () => {
    const { unmount } = render(
      <Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={() => {}} />,
    );

    const sukses = screen.getByTestId("toast");
    expect(sukses.className).toContain("bg-[#273a52]");
    expect(sukses.className).toContain("text-[#eaedf3]");
    expect(sukses.className).toContain("rounded-lg");
    expect(sukses.className).not.toContain("bg-white");
    // Teks #eaedf3 di atas #273a52 = 9.8:1; jenis pesan dibaca dari tint ikon.
    expect(sukses.querySelector("svg")?.getAttribute("class")).toContain("text-green-300");
    unmount();

    render(<Toast pesan="Gagal menyinkronkan data." jenis="gagal" onTutup={() => {}} />);
    expect(screen.getByTestId("toast").querySelector("svg")?.getAttribute("class")).toContain(
      "text-red-300",
    );
  });
});
