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

  it("memakai latar GCP Console #F0F5FE agar menyatu dengan topbar dan kanvas", () => {
    const { container } = render(<Sidebar />);
    const aside = container.querySelector("aside") as HTMLElement;

    expect(aside.className).toContain("bg-[#F0F5FE]");
    expect(aside.className).not.toContain("bg-white");
    // Mepet ke tepi jendela: sisi kiri tetap siku, sudut kanan yang membulat.
    // Sudut kanan membulat tegas (24px / 3xl) agar lengkungan terbaca jelas di layar lebar.
    // Sudut kanan-atas siku agar header 64px menyatu lurus dengan topbar,
    // sudut kanan-bawah membulat tegas (24px / 3xl) agar menu tetap mengambang.
    expect(aside.className).toContain("rounded-br-3xl");
    expect(aside.className).not.toContain("rounded-r-3xl");
    expect(aside.className).not.toContain("rounded-tr");
    expect(aside.className).not.toContain("rounded-l");
    expect(aside.className).not.toContain("rounded-xl");
    expect(aside.className).not.toContain("m-3");
    expect(aside.className).toContain("h-screen");
    // Garis pemisah tetap ada di sisi kanan saja.
    // Garis pemisah diganti bayangan lembut ke arah kanan supaya panel terbaca mengambang.
    // Blur 12px: e2e/dashboard.spec.ts memberi pengecualian khusus <aside>, lihat komentarnya.
    expect(aside.className).not.toContain("border-r");
    expect(aside.className).toMatch(/shadow-\[/);
    expect(aside.className).toContain("z-10");
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
