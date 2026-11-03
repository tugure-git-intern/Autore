import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { Folder } from "lucide-react";

// The sidebar reads the App Router pathname; pin it to "/" for the unit run.
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { EmptyApplications } from "./empty-applications";
import { Sidebar } from "./sidebar";
import { StatCard } from "./stat-card";
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
});

describe("Sidebar", () => {
  it("labels the three PRD routes and highlights the active one", () => {
    render(<Sidebar />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/", "/applications", "/pipeline"]);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveClass("bg-green-50", "text-green-700");
    expect(screen.getByRole("link", { name: "Daftar Aplikasi" })).not.toHaveClass("bg-green-50");
    expect(screen.getByRole("link", { name: "Pipeline & Log" })).not.toHaveClass("bg-green-50");

    expect(screen.queryByText(/buat aplikasi|tambah aplikasi|aplikasi baru/i)).toBeNull();
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
});
