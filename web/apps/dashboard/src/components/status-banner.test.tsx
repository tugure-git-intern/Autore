import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BANNER_BASI,
  BANNER_GAGAL,
  StatusBanner,
} from "./status-banner";

describe("StatusBanner", () => {
  it("merah dan menyebut Jenkins hanya saat tarikan API gagal", () => {
    render(<StatusBanner stale={false} failed />);

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(BANNER_GAGAL);
    expect(banner.className).toContain("border-red-200");
  });

  it("kuning tanpa menyalahkan Jenkins saat data basi", () => {
    render(<StatusBanner stale failed={false} />);

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(BANNER_BASI);
    expect(banner.textContent).not.toContain("Gagal terhubung ke Jenkins");
    expect(banner.className).toContain("border-amber-200");
  });

  it("tidak merender apa pun saat data segar", () => {
    const { container } = render(<StatusBanner stale={false} failed={false} />);

    expect(container.firstChild).toBeNull();
  });
});
