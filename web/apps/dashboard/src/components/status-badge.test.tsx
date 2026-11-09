import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { Folder } from "lucide-react";

// The sidebar reads the App Router pathname; pin it to "/" for the unit run.
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { EmptyApplications } from "./empty-applications";
import { Sidebar } from "./sidebar";
import { StatCard, type StatTone } from "./stat-card";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders neutral text for unknown security state", () => {
    render(<StatusBadge status="unknown" />);
    expect(screen.getByText("Belum ada hasil scan")).toHaveClass("bg-gray-100", "text-gray-700");
  });

  it("maps passed and running to pastel badges", () => {
    render(<StatusBadge status="passed" />);
    expect(screen.getByText("Lulus")).toHaveClass("bg-green-100", "text-green-700");
  });

  it("flags failures with an alert role", () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal");
  });
});

describe("StatCard", () => {
  it("uses a thin border and no elevation", () => {
    render(<StatCard label="Total Terdaftar" value="12" icon={Folder} tone="blue" />);
    const card = screen.getByText("Total Terdaftar").closest("section");
    expect(card).toHaveClass("border", "border-gray-200");
    expect(card?.className).not.toMatch(/shadow/);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("keeps the value on a single line so the four cards stay even", () => {
    render(<StatCard label="Infrastruktur CI/CD" value="Jenkins & Nexus" icon={Folder} tone="violet" />);
    expect(screen.getByText("Jenkins & Nexus")).toHaveClass("whitespace-nowrap");
  });

  it("puts the icon tile on the label row and the value below it", () => {
    const { container } = render(
      <StatCard label="Infrastruktur CI/CD" value="Jenkins & Nexus" icon={Folder} tone="violet" />,
    );
    const card = container.querySelector("section") as HTMLElement;
    const label = screen.getByText("Infrastruktur CI/CD");
    const value = screen.getByText("Jenkins & Nexus");
    const tile = card.querySelector("[aria-hidden='true']") as HTMLElement;

    expect(tile.parentElement).toBe(label.parentElement);
    expect(value.parentElement).toBe(card);
    expect(tile.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the four PRD stat tints on the icon tiles", () => {
    const tints: Record<StatTone, string> = {
      blue: "bg-blue-50",
      green: "bg-green-50",
      violet: "bg-violet-50",
      amber: "bg-amber-50",
    };

    for (const [tone, tint] of Object.entries(tints) as [StatTone, string][]) {
      const { container, unmount } = render(<StatCard label="Label" value="Nilai" icon={Folder} tone={tone} />);
      expect(container.querySelector("[aria-hidden='true']")).toHaveClass(tint);
      unmount();
    }
  });
});

describe("Sidebar", () => {
  it("labels the PRD routes and highlights the active one in PRD green", () => {
    render(<Sidebar />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/", "/applications", "/pipeline", "/security", "/audit"]);

    // PRD: menu aktif memakai bg-green-50 text-green-700.
    const active = screen.getByRole("link", { name: "Dashboard" });
    expect(active).toHaveClass("bg-green-50", "text-green-700");
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Daftar Aplikasi" })).not.toHaveClass("bg-green-50");
    expect(screen.getByRole("link", { name: "Pipeline & Log" })).not.toHaveClass("bg-green-50");

    expect(screen.queryByText(/buat aplikasi|tambah aplikasi|aplikasi baru/i)).toBeNull();
  });

  it("sizes the brand block to the 64px topbar without orphaned border line", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-brand")).toHaveClass("h-16");
    expect(screen.getByTestId("sidebar-brand").className).not.toContain("border");
  });

  it("insets active and inactive nav pills identically", () => {
    render(<Sidebar />);
    const aside = screen.getByRole("complementary");
    const links = within(aside).getAllByRole("link");

    for (const link of links) {
      expect(link).toHaveClass("px-3", "items-center", "gap-3");
      expect(link.className).not.toMatch(/-m[lrxt]/);
    }
  });
});

describe("EmptyApplications", () => {
  it("states the registry is empty without inventing data", () => {
    render(<EmptyApplications />);
    expect(screen.getByText("Belum ada aplikasi yang didaftarkan.")).toBeVisible();
  });

  it("adds no second border box inside the already-bordered panel", () => {
    const { container } = render(<EmptyApplications />);
    expect(container.querySelector(".border")).toBeNull();
  });

  it("hugs 160px, keeps a neutral tile and only the heading copy", () => {
    const { container } = render(<EmptyApplications />);
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass("min-h-[160px]", "text-muted");
    expect(root.className).not.toMatch(/py-(1[6-9]|2[0-9])/);
    expect(root.textContent).toBe("Belum ada aplikasi yang didaftarkan.");

    const tile = root.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(tile).toHaveClass("bg-gray-100");
    expect(tile.className).not.toMatch(/bg-(blue|green|violet|amber)-/);
  });
});