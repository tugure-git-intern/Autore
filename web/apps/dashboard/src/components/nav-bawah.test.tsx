import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// AppShell membaca pathname App Router; tes ini mengunci rute aktifnya.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { NavBawah } from "./nav-bawah";

afterEach(() => {
  nav.pathname = "/";
});

describe("NavBawah", () => {
  it("lima tujuan dengan label pendek, semuanya sasaran sentuh 44px", () => {
    render(<NavBawah />);

    const tautan = screen.getAllByRole("link");
    expect(tautan.map((t) => t.textContent)).toEqual([
      "Dashboard",
      "Aplikasi",
      "Pipeline",
      "Keamanan",
      "Audit",
    ]);
    for (const t of tautan) expect(t.className).toContain("min-h-11");
    // "Daftar Aplikasi"/"Pipeline & Log" tidak muat di satu kolom 390px.
    expect(screen.queryByText("Daftar Aplikasi")).toBeNull();
  });

  it("menandai rute aktif saja, dan subpath ikut induknya", () => {
    nav.pathname = "/applications/sbom";
    render(<NavBawah />);

    expect(screen.getByRole("link", { name: "Aplikasi" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Keamanan" })).not.toHaveAttribute("aria-current");
  });

  it("menempel di bawah layar, aman dari home indicator, dan menyembunyikan diri di desktop", () => {
    const { container } = render(<NavBawah />);

    const bar = screen.getByRole("navigation", { name: "Navigasi bawah" });
    expect(bar.className).toContain("fixed");
    expect(bar.className).toContain("bottom-0");
    expect(bar.className).toContain("lg:hidden");
    expect(bar.className).toContain("pb-[env(safe-area-inset-bottom)]");
    // Empat kolom sama lebar: tidak ada tujuan yang terpotong.
    expect(container.querySelector("nav > div")?.className).toContain("grid-cols-5");
  });

  it("memakai latar GCP Console #F0F5FE agar menyatu dengan topbar dan kanvas", () => {
    render(<NavBawah />);

    const bar = screen.getByRole("navigation", { name: "Navigasi bawah" });
    expect(bar.className).toContain("bg-[#F0F5FE]");
    expect(bar.className).not.toContain("bg-white");
    expect(bar.className).toContain("border-t");
    expect(bar.className).toContain("border-gray-200");
  });

  it("mewarnai menu non-aktif #545F72 dan membiarkan menu aktif tetap hijau", () => {
    nav.pathname = "/pipeline";
    render(<NavBawah />);

    const aktif = screen.getByRole("link", { name: "Pipeline" });
    expect(aktif.className).toContain("text-green-700");
    // Bar bawah memakai chrome yang sama; penandanya juga harus green-100.
    expect(aktif.className).toContain("bg-green-100");
    expect(aktif.className).not.toContain("bg-green-50");

    const nonAktif = screen.getByRole("link", { name: "Keamanan" });
    expect(nonAktif.className).toContain("text-[#545F72]");
    expect(nonAktif.className).not.toContain("text-muted");
  });
});
