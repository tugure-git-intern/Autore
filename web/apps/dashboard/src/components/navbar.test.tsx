import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// AppShell renders the sidebar, which reads the App Router pathname.
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import type { ApiStatusResponse } from "@/lib/contracts";
import { AppShell } from "./app-shell";
import { connectionStatus, Navbar } from "./navbar";

function status(jenkins: "active" | "inactive" | "unknown", stale = false): ApiStatusResponse {
  return {
    data: {
      system_status: "idle",
      infra: { jenkins, nexus: "active" },
      stats: { total_apps: 0, running_containers: 0 },
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
  vi.unstubAllGlobals();
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
  it("carries a non-heading title, the status dot, Sync and the initials avatar", () => {
    render(
      <Navbar
        title="Dashboard"
        connection={{ tone: "green", label: "Sistem Siap" }}
        onSync={() => {}}
        initials="AR"
      />,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Dashboard", { selector: "p" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Sistem Siap");
    expect(screen.getByRole("button", { name: "Sync" })).toBeVisible();
    expect(screen.getByText("AR")).toBeVisible();
  });
});

describe("AppShell", () => {
  it("refetches only /api/status when the navbar Sync button is pressed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => status("active") } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell>
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
