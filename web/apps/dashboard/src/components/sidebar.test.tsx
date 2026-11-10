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

  it("berbentuk kartu melayang tanpa sekat: renggang dari tepi, sudut melengkung penuh", () => {
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
    // Nyatu penuh dengan chrome: bidang sama dengan latar utama #F0F5FE, tanpa
    // border dan tanpa bayangan, supaya tidak ada gradasi tepi yang terbaca
    // sebagai sekat antara sidebar dan area konten.
    expect(aside.className).toContain("bg-[#F0F5FE]");
    expect(aside.className).not.toContain("bg-white");
    expect(aside.className).not.toContain("border");
    expect(aside.className).not.toContain("shadow");
  });

  it("mewarnai menu non-aktif #545F72 dan membiarkan menu aktif tetap hijau", () => {
    render(<Sidebar />);

    const aktif = screen.getByRole("link", { name: /pipeline/i });
    expect(aktif.className).toContain("text-green-700");
    // Latar sidebar kini chrome #F0F5FE; pil green-50 nyaris hilang di atasnya,
    // jadi penanda menu aktif naik satu tingkat ke green-100.
    expect(aktif.className).toContain("bg-green-100");
    expect(aktif.className).not.toContain("bg-green-50");

    const nonAktif = screen.getByRole("link", { name: /daftar aplikasi/i });
    expect(nonAktif.className).toContain("text-[#545F72]");
    expect(nonAktif.className).not.toContain("text-muted");
  });

  it("mendukung palet dark mode #282c32 untuk latar sidebar dan #ffffff untuk teks non-aktif", () => {
    const { container } = render(<Sidebar />);
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.className).toContain("bg-[#F0F5FE]");
    expect(aside.className).toContain("dark:bg-[#282c32]");

    const nonAktif = screen.getByRole("link", { name: /daftar aplikasi/i });
    expect(nonAktif.className).toContain("dark:text-white");
    expect(nonAktif.className).toContain("dark:hover:bg-[#353b43]");
  });
  it("menampilkan indikator status Server Online dan versi di pojok bawah", () => {
    render(<Sidebar />);

    const footer = screen.getByTestId("sidebar-footer");
    expect(footer.className).toContain("flex items-center justify-between");
    expect(footer.className).toContain("px-4 py-3");
    expect(footer.className).toContain("border-t");
    expect(footer.className).toContain("border-gray-200");
    expect(footer.className).toContain("dark:border-[#50638b]");

    // Titik hijau animate-pulse
    const dot = screen.getByTestId("server-online-dot");
    expect(dot.className).toContain("w-2.5");
    expect(dot.className).toContain("h-2.5");
    expect(dot.className).toContain("rounded-full");
    expect(dot.className).toContain("bg-green-500");
    expect(dot.className).toContain("animate-pulse");

    // Teks Server Online
    const statusText = screen.getByText("Server Online");
    expect(statusText.className).toContain("text-sm");
    expect(statusText.className).toContain("font-medium");
    expect(statusText.className).toContain("text-gray-900");
    expect(statusText.className).toContain("dark:text-white");

    // Teks Versi
    const versionText = screen.getByText("v0.5.9");
    expect(versionText.className).toContain("text-xs");
    expect(versionText.className).toContain("font-mono");
    expect(versionText.className).toMatch(/text-gray-[56]00/);
    expect(versionText.className).toContain("dark:text-gray-400");
  });
});
