import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceMenu } from "./appearance-menu";

const tema = vi.hoisted(() => ({ nilai: "light", setTheme: vi.fn() }));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: tema.nilai, resolvedTheme: tema.nilai, setTheme: tema.setTheme }),
}));

const bukaModal = () => {
  fireEvent.click(screen.getByRole("button", { name: "Menu lainnya" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Penampilan/ }));
  return screen.getByRole("dialog", { hidden: true });
};

describe("AppearanceMenu", () => {
  beforeEach(() => {
    tema.nilai = "light";
    tema.setTheme.mockClear();
    window.localStorage.clear();
    document.documentElement.classList.remove("high-contrast");
  });

  it("menu kebab tertutup awalnya dan membuka item Penampilan saat diklik", () => {
    render(<AppearanceMenu />);
    const kebab = screen.getByRole("button", { name: "Menu lainnya" });
    expect(kebab).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menuitem", { name: /Penampilan/ })).toBeNull();

    fireEvent.click(kebab);
    expect(kebab).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("dark:bg-[#282c32]");
    expect(menu.className).toContain("dark:border-[#50638b]");
  });

  it("modal lebar #3c444e memuat 3 kartu radio dengan miniatur UI masing-masing", () => {
    render(<AppearanceMenu />);
    const modal = bukaModal();

    expect(modal).toHaveAttribute("open");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("heading", { name: "Pilih Tema Tampilan" })).toBeVisible();
    expect(modal.className).toContain("bg-[#3c444e]");
    expect(modal.className).toContain("text-white");
    expect(modal.className).toContain("rounded-xl");
    expect(modal.className).toMatch(/max-w-(xl|2xl)/);

    const terang = screen.getByRole("radio", { name: "Terang" });
    const gelap = screen.getByRole("radio", { name: "Gelap" });
    const sistem = screen.getByRole("radio", { name: "Ikuti Sistem" });

    expect(terang).toHaveAttribute("aria-checked", "true");
    expect(terang.className).toContain("border-blue-500");
    expect(gelap).toHaveAttribute("aria-checked", "false");
    expect(gelap.className).not.toContain("border-blue-500");
    expect(sistem).toHaveAttribute("aria-checked", "false");

    const pratinjauTerang = within(terang).getByTestId("preview-light");
    const pratinjauGelap = within(gelap).getByTestId("preview-dark");
    const pratinjauSistem = within(sistem).getByTestId("preview-system");
    expect(pratinjauTerang.className).toContain("bg-white");
    expect(pratinjauGelap.className).toContain("bg-[#282c32]");
    expect(pratinjauSistem.querySelectorAll("[data-testid='preview-half']")).toHaveLength(2);
  });

  it("klik kartu mengganti tema ke light, dark, atau system lewat next-themes", () => {
    render(<AppearanceMenu />);
    bukaModal();

    fireEvent.click(screen.getByRole("radio", { name: "Gelap" }));
    expect(tema.setTheme).toHaveBeenCalledWith("dark");
    fireEvent.click(screen.getByRole("radio", { name: "Ikuti Sistem" }));
    expect(tema.setTheme).toHaveBeenCalledWith("system");
    fireEvent.click(screen.getByRole("radio", { name: "Terang" }));
    expect(tema.setTheme).toHaveBeenCalledWith("light");
  });

  it("kartu aktif mengikuti nilai theme (termasuk system)", () => {
    tema.nilai = "system";
    render(<AppearanceMenu />);
    bukaModal();
    expect(screen.getByRole("radio", { name: "Ikuti Sistem" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Terang" })).toHaveAttribute("aria-checked", "false");
  });

  it("sakelar Kontras Tinggi memiliki subteks, menyetel html.high-contrast, dan tersimpan di localStorage", () => {
    render(<AppearanceMenu />);
    bukaModal();

    expect(
      screen.getByText("Meningkatkan kontras antara teks dan latar belakang."),
    ).toBeVisible();
    const sakelar = screen.getByRole("switch", { name: /Kontras Tinggi/ });
    expect(sakelar).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);

    fireEvent.click(sakelar);
    expect(sakelar).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
    expect(window.localStorage.getItem("autore-high-contrast")).toBe("1");

    fireEvent.click(sakelar);
    expect(sakelar).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);
    expect(window.localStorage.getItem("autore-high-contrast")).toBe("0");
  });

  it("tombol X dan klik di luar panel menutup modal, klik di dalam tidak", () => {
    render(<AppearanceMenu />);
    let modal = bukaModal();
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(modal).not.toHaveAttribute("open");

    modal = bukaModal();
    fireEvent.click(screen.getByRole("heading", { name: "Pilih Tema Tampilan" }));
    expect(modal).toHaveAttribute("open");
    fireEvent.click(modal);
    expect(modal).not.toHaveAttribute("open");
  });
});
