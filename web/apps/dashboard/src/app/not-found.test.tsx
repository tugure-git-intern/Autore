import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "./not-found";

describe("Global 404 page (not-found.tsx)", () => {
  it("merender informasi halaman tidak ditemukan dan tautan kembali ke beranda", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: /Halaman Tidak Ditemukan/i })).toBeInTheDocument();
    expect(screen.getByText(/404/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Kembali ke Dashboard/i });
    expect(link).toHaveAttribute("href", "/");
  });
});
