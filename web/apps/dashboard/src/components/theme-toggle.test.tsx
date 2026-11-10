import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./theme-toggle";

const setThemeMock = vi.fn();
let currentTheme = "light";

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: currentTheme,
    resolvedTheme: currentTheme,
    setTheme: setThemeMock,
  }),
}));

describe("ThemeToggle", () => {
  it("menampilkan tombol pengubah tema dan mengganti light ke dark saat diklik", () => {
    currentTheme = "light";
    setThemeMock.mockClear();
    render(<ThemeToggle />);
    const btn = screen.getByTestId("theme-toggle");
    expect(btn).toHaveAttribute("aria-label", "Aktifkan mode gelap");
    fireEvent.click(btn);
    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("mengganti dark ke light saat tema aktif adalah dark", () => {
    currentTheme = "dark";
    setThemeMock.mockClear();
    render(<ThemeToggle />);
    const btn = screen.getByTestId("theme-toggle");
    expect(btn).toHaveAttribute("aria-label", "Aktifkan mode terang");
    fireEvent.click(btn);
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });
});
