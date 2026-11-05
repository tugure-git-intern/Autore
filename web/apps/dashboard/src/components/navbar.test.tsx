import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// AppShell renders the sidebar, which reads the App Router pathname. Mutable so
// each test can stand on a different route.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import type { ApiStatusResponse } from "@/lib/contracts";
import type { SessionUser } from "@/lib/current-user";
import { AppShell } from "./app-shell";
import { connectionStatus, Navbar } from "./navbar";

const USER: SessionUser = { login: "tugure-git-intern", name: "Alif", image: "https://x/a.png" };
const TAMU: SessionUser = { login: "", name: "", image: null };

function status(jenkins: "active" | "inactive" | "unknown", stale = false): ApiStatusResponse {
  return {
    data: {
      system_status: "idle",
      infra: { jenkins, nexus: "active" },
      stats: { total_apps: 0, running_containers: 0 },
      repository_health: { score_percent: 0, total_repos: 0, gold: 0, silver: 0, bronze: 0 },
      applications: [],
      latest_pipeline: {
        status: "idle",
        failure_reason: "",
        stages: [],
        security_summary: "",
        commit_sha: "",
        author: "",
        raw_log: [],
      },
    },
    stale,
  };
}

afterEach(() => {
  nav.pathname = "/";
  vi.unstubAllGlobals();
});

describe("topbar route context", () => {
  function renderShell(pathname: string) {
    nav.pathname = pathname;
    // Hang the shared status fetch: the shell is all we assert here.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    return render(
      <AppShell user={USER}>
        <div />
      </AppShell>,
    );
  }

  it.each([
    ["/", "Autore"],
    ["/applications", "Daftar Aplikasi"],
    ["/pipeline", "Pipeline & Log"],
  ])("titles the 64px topbar from the route (%s)", (pathname, expected) => {
    renderShell(pathname);

    const banner = within(screen.getByRole("banner"));
    expect(banner.getByText(expected, { selector: "p" })).toBeVisible();
  });

  it("never repeats the dashboard heading in the topbar", () => {
    renderShell("/");

    const banner = within(screen.getByRole("banner"));
    expect(banner.getByText("Autore", { selector: "p" })).toBeVisible();
    expect(banner.queryByText("Dashboard", { selector: "p" })).toBeNull();
  });

  it("drops the sidebar and topbar on the auth pages", () => {
    renderShell("/login");

    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Navigasi utama" })).toBeNull();
  });
});

describe("connectionStatus", () => {
  it("is green with the exact ready copy only for fresh, active Jenkins", () => {
    expect(connectionStatus(status("active"), false, false)).toEqual({
      tone: "green",
      label: "Sistem Siap",
    });
  });

  it("never claims ready when stale, failed or Jenkins is not active", () => {
    expect(connectionStatus(status("active", true), false, false).tone).toBe("red");
    expect(connectionStatus(status("active"), false, true).tone).toBe("red");
    expect(connectionStatus(status("inactive"), false, false)).toEqual({
      tone: "neutral",
      label: "Jenkins tidak aktif",
    });
    expect(connectionStatus(status("unknown"), false, false).tone).toBe("neutral");
    expect(connectionStatus(null, true, false).tone).toBe("neutral");
    expect(connectionStatus(null, false, true).tone).toBe("red");
  });
});

describe("Navbar", () => {
  function renderNavbar(user: SessionUser) {
    const hasil = render(
      <Navbar
        title="Dashboard"
        connection={{ tone: "green", label: "Sistem Siap" }}
        onSync={() => {}}
        user={user}
      />,
    );
    // Isi <details> yang tertutup dianggap tidak terlihat oleh jsdom.
    const details = hasil.container.querySelector("details");
    if (details) details.open = true;
    return hasil;
  }

  it("carries a non-heading title, the status dot, Sync and the signed-in user", () => {
    renderNavbar(USER);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Dashboard", { selector: "p" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Sistem Siap");
    expect(screen.getByRole("button", { name: "Sync" })).toBeVisible();
    expect(screen.getByAltText("tugure-git-intern")).toBeVisible();
    expect(screen.getByRole("button", { name: /keluar/i })).toBeVisible();
  });

  it("tidak menampilkan menu pengguna saat belum ada sesi", () => {
    renderNavbar(TAMU);

    expect(screen.queryByRole("button", { name: /keluar/i })).toBeNull();
    expect(screen.queryByText(/^@/)).toBeNull();
  });
});

describe("AppShell", () => {
  it("refetches only /api/status when the navbar Sync button is pressed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => status("active") } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell user={USER}>
        <div />
      </AppShell>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/status");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
});
