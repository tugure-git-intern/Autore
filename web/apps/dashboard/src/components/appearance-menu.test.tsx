import { fireEvent, render, screen } from "@testing-library/react";
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

  it("Penampilan membuka modal #3c444e dengan dua kartu, kartu aktif disorot biru", () => {
    render(<AppearanceMenu />);
    const modal = bukaModal();

    expect(modal).toHaveAttribute("open");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("heading", { name: "Pilih Tema Tampilan" })).toBeVisible();
    expect(modal.className).toContain("bg-[#3c444e]");
    expect(modal.className).toContain("text-white");
    expect(modal.className).toContain("rounded-xl");
    expect(modal.className).toContain("backdrop:bg-black/60");

    const terang = screen.getByRole("button", { name: /Terang/ });
    const gelap = screen.getByRole("button", { name: /Gelap/ });
    expect(terang).toHaveAttribute("aria-pressed", "true");
    expect(terang.className).toContain("border-blue-500");
    expect(gelap).toHaveAttribute("aria-pressed", "false");
    expect(gelap.className).not.toContain("border-blue-500");
  });

  it("klik kartu langsung mengganti tema lewat next-themes", () => {
    render(<AppearanceMenu />);
    bukaModal();

    fireEvent.click(screen.getByRole("button", { name: /Gelap/ }));
    expect(tema.setTheme).toHaveBeenCalledWith("dark");
    fireEvent.click(screen.getByRole("button", { name: /Terang/ }));
    expect(tema.setTheme).toHaveBeenCalledWith("light");
  });

  it("tema gelap aktif menyorot kartu Gelap", () => {
    tema.nilai = "dark";
    render(<AppearanceMenu />);
    bukaModal();
    expect(screen.getByRole("button", { name: /Gelap/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("tombol X dan klik di luar panel menutup modal", () => {
    render(<AppearanceMenu />);
    let modal = bukaModal();
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(modal).not.toHaveAttribute("open");

    modal = bukaModal();
    fireEvent.click(modal);
    expect(modal).not.toHaveAttribute("open");
  });

  it("klik di dalam panel tidak menutup modal", () => {
    render(<AppearanceMenu />);
    const modal = bukaModal();
    fireEvent.click(screen.getByRole("heading", { name: "Pilih Tema Tampilan" }));
    expect(modal).toHaveAttribute("open");
  });
});
