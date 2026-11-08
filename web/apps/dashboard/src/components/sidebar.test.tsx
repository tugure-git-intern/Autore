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
});