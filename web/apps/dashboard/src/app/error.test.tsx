import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./error";

describe("Global error boundary (error.tsx)", () => {
  it("merender kartu alert dan tombol coba lagi yang memanggil reset", () => {
    const reset = vi.fn();
    const error = new Error("Network timeout");

    render(<ErrorBoundary error={error} reset={reset} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Terjadi Kesalahan pada Aplikasi/i })).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat komponen antarmuka/i)).toBeInTheDocument();

    const cobaLagi = screen.getByRole("button", { name: /Coba Lagi/i });
    expect(cobaLagi).toBeInTheDocument();
    fireEvent.click(cobaLagi);
    expect(reset).toHaveBeenCalledTimes(1);

    const beranda = screen.getByRole("link", { name: /Kembali ke Dashboard/i });
    expect(beranda).toHaveAttribute("href", "/");
  });

  it("tidak membocorkan raw stack trace ke layar pengguna", () => {
    const error = new Error("KREDENSIAL_SANGAT_RAHASIA_INTERNAL_TRACE");
    error.stack = "Error: at secretFunction (/sensitive/path.ts:123)";

    render(<ErrorBoundary error={error} reset={vi.fn()} />);

    expect(screen.queryByText(/secretFunction/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sensitive\/path/i)).not.toBeInTheDocument();
  });
});
