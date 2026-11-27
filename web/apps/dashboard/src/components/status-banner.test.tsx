import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BahasaProvider } from "./bahasa-provider";
import { StatusBanner } from "./status-banner";

describe("StatusBanner", () => {
  it("merah dan menyebut Jenkins hanya saat tarikan API gagal", () => {
    render(<StatusBanner stale={false} failed />);

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Gagal terhubung ke Jenkins. Menampilkan data terakhir.");
    expect(banner.className).toContain("border-red-200");
  });

  it("kuning tanpa menyalahkan Jenkins saat data basi", () => {
    render(<StatusBanner stale failed={false} />);

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Data terakhir ditampilkan; status terbaru belum terbaca.");
    expect(banner.textContent).not.toContain("Gagal terhubung ke Jenkins");
    expect(banner.className).toContain("border-amber-200");
  });

  it("memakai bahasa aktif, bukan teks tetap", () => {
    render(
      <BahasaProvider awal="en">
        <StatusBanner stale={false} failed />
      </BahasaProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not reach Jenkins. Showing the last data.",
    );
  });

  it("tidak merender apa pun saat data segar", () => {
    const { container } = render(<StatusBanner stale={false} failed={false} />);

    expect(container.firstChild).toBeNull();
  });
});