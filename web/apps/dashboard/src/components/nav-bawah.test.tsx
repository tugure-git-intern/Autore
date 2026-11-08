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
});
