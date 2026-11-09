import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/pipeline" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { Sidebar } from "./sidebar";

describe("Sidebar", () => {
  it("menaruh logo Tugu Reasuransi di samping nama Autore", () => {
    render(<Sidebar />);

    const logo = screen.getByRole("img", { name: "Tugu Reasuransi" });
    expect(logo).toHaveAttribute("src", "/tugure-logo-asli.png");
    expect(logo.className).toContain("h-10");
    expect(logo.className).toContain("w-auto");
    // object-contain + shrink-0: ikon tidak boleh dipotong atau digencet flex.
    expect(logo.className).toContain("object-contain");
    expect(logo.className).toContain("shrink-0");
    expect(screen.getByTestId("sidebar-brand").className).toContain("items-center gap-3");
    // Garis abu-abu di bawah logo dihapus agar tidak terputus di tengah jalan
    // saat menu dan navbar terpisah oleh celah 12px.
    expect(screen.getByTestId("sidebar-brand").className).not.toContain("border");
    expect(screen.getByTestId("sidebar-brand").className).not.toContain("border-b");
    expect(screen.getByText("Autore")).toBeTruthy();
  });

  it("tetap menandai rute yang sedang dibuka", () => {
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: /pipeline/i })).toHaveAttribute("aria-current", "page");
  });

  it("merender menu Audit Log di bawah Keamanan", () => {
    render(<Sidebar />);
    const auditLink = screen.getByRole("link", { name: /audit log/i });
    expect(auditLink).toHaveAttribute("href", "/audit");
  });

  it("berbentuk kartu melayang: renggang dari tepi, sudut melengkung penuh, border tipis", () => {
    const { container } = render(<Sidebar />);
    const aside = container.querySelector("aside") as HTMLElement;

    // Keluar dari alur flex dan menempel 12px dari tepi kiri/atas/bawah viewport,
    // jadi topbar di belakangnya bisa membentang penuh tanpa terputus.
    expect(aside.className).toContain("fixed");
    expect(aside.className).toContain("left-3");
    expect(aside.className).toContain("top-3");
    expect(aside.className).toContain("bottom-3");
    expect(aside.className).not.toContain("sticky");
    expect(aside.className).not.toContain("h-screen");
    // Menumpuk di atas topbar (z-10).
    expect(aside.className).toContain("z-20");
    // Sudut melengkung di keempat sisi, bukan cuma sisi kanan.
    expect(aside.className).toContain("rounded-2xl");
    expect(aside.className).not.toContain("rounded-br-");
    expect(aside.className).not.toContain("rounded-r-");
    expect(aside.className).not.toContain("rounded-l");
    // Bidang putih + garis tipis: batas kartu dibaca dari border, bukan bayangan berat.
    expect(aside.className).toContain("bg-white");
    expect(aside.className).toContain("border");
    expect(aside.className).toContain("border-gray-200");
    expect(aside.className).toContain("shadow-sm");
    expect(aside.className).not.toContain("border-r");
    expect(aside.className).not.toContain("border-b");
  });

  it("mewarnai menu non-aktif #545F72 dan membiarkan menu aktif tetap hijau", () => {
    render(<Sidebar />);

    const aktif = screen.getByRole("link", { name: /pipeline/i });
    expect(aktif.className).toContain("text-green-700");

    const nonAktif = screen.getByRole("link", { name: /daftar aplikasi/i });
    expect(nonAktif.className).toContain("text-[#545F72]");
    expect(nonAktif.className).not.toContain("text-muted");
  });
});
