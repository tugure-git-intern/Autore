import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import type { ApiStatusResponse, DashboardStatus } from "@/lib/contracts";
import { DashboardOverview } from "./dashboard-overview";

const base: DashboardStatus = {
  system_status: "idle",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 2 },
  applications: [
    {
      id: "app-portal-klaim",
      name: "Portal Klaim",
      status: "passed",
      last_build: "2026-11-03T10:00:00Z",
      commit_sha: "a1b2c3d4e5f6",
      security_issues: 0,
    },
  ],
  latest_pipeline: {
    status: "idle",
    failure_reason: "",
    stages: [],
    security_summary: "",
    commit_sha: "",
    author: "",
    raw_log: [],
  },
};

function respond(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => body } as unknown as Response;
}

function mockStatus(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue(respond(body, ok));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DashboardOverview", () => {
  it("shows skeletons instead of a blank screen while loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    render(<DashboardOverview />);

    expect(screen.getByRole("region", { name: "Memuat status" })).toBeInTheDocument();
    expect(screen.queryByText("Belum ada aplikasi yang didaftarkan.")).toBeNull();
  });

  it("renders the empty applications state without inventing data", async () => {
    mockStatus({
      data: { ...base, stats: { total_apps: 0, running_containers: 0 }, applications: [] },
      stale: false,
    });

    render(<DashboardOverview />);

    expect(await screen.findByText("Belum ada aplikasi yang didaftarkan.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders fresh status: stat cards, exact columns, mono SHA and detail link", async () => {
    mockStatus({ data: base, stale: false });

    render(<DashboardOverview />);

    expect(await screen.findByText("Portal Klaim")).toBeVisible();
    for (const column of ["Nama Aplikasi", "Status Keamanan", "Terakhir Diperbarui", "Aksi"]) {
      expect(screen.getByRole("columnheader", { name: column })).toBeVisible();
    }
    expect(screen.getByText("Total Terdaftar")).toBeVisible();
    expect(screen.getByText("Container Berjalan")).toBeVisible();
    expect(screen.getByText("Jenkins & Nexus")).toBeVisible();
    expect(screen.getByText("Status Pipeline")).toBeVisible();
    expect(screen.getByText("a1b2c3d4e5f6")).toHaveClass("font-mono");
    expect(screen.getByText("Lulus")).toBeVisible();
    expect(screen.queryByText("Gagal terhubung ke Jenkins. Menampilkan data terakhir.")).toBeNull();
    expect(screen.getByRole("link", { name: "Detail" })).toHaveAttribute(
      "href",
      "/pipeline?app=app-portal-klaim",
    );
  });

  it("shows the exact stale alert while keeping the last data visible", async () => {
    mockStatus({ data: base, stale: true });

    render(<DashboardOverview />);

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Gagal terhubung ke Jenkins. Menampilkan data terakhir.");
    expect(screen.getByText("Portal Klaim")).toBeVisible();
  });

  it("renders a failed application with a red badge and dashes for missing fields", async () => {
    mockStatus({
      data: {
        ...base,
        applications: [
          {
            id: "app-portal-klaim",
            name: "Portal Klaim",
            status: "failed",
            last_build: "",
            commit_sha: "",
            security_issues: 1,
          },
        ],
      },
      stale: false,
    });

    render(<DashboardOverview />);

    const row = (await screen.findByText("Portal Klaim")).closest("tr");
    expect(row).not.toBeNull();
    const tools = within(row as HTMLElement);
    expect(tools.getByText("Gagal")).toBeInTheDocument();
    expect(tools.queryByText("Lulus")).toBeNull();
    expect(tools.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("refetches only /api/status when Sync is pressed", async () => {
    const fetchMock = mockStatus({ data: base, stale: false });

    render(<DashboardOverview />);
    await screen.findByText("Portal Klaim");

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/status");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("reports a hard failure when the API returns 503", async () => {
    mockStatus({ error: "Autore status unavailable" }, false);

    render(<DashboardOverview />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Status Autore belum tersedia.");
  });
});