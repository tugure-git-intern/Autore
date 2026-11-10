import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("Global loading skeleton (loading.tsx)", () => {
  it("merender elemen dengan role status dan teks deskriptif untuk pembaca layar", () => {
    render(<Loading />);

    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(screen.getByText(/Memuat data dashboard/i)).toBeInTheDocument();
  });
});
