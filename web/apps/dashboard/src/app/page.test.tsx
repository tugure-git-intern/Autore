import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { AppShell, StatusProvider } from "@/components/app-shell";
import DashboardPage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders Autore Dashboard heading", () => {
  // Hang the shared status fetch so the page settles on its loading skeleton.
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
});

test("the topbar carries route context and never repeats the H1 word", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(
    <AppShell>
      <DashboardPage />
    </AppShell>,
  );

  const h1 = screen.getByRole("heading", { name: "Dashboard" });
  const topbar = within(screen.getByRole("banner")).getByText("Autore", { selector: "p" });

  expect(topbar.textContent).not.toBe(h1.textContent);
  expect(topbar.textContent).not.toContain(h1.textContent ?? "");
});
const STATUS = {
  system_status: "idle",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 0 },
  applications: [
    {
      id: "tes-web",
      name: "tes-web",
      status: "unknown",
      last_build: "",
      commit_sha: "",
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

test("menaruh tombol Deploy Sekarang di pojok kanan atas dengan peringatan commit dan push", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body =
      String(input) === "/api/status"
        ? { data: STATUS, stale: false }
        : { ok: true, action: "deploy", target: "tes-web" };
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  const button = await screen.findByRole("button", { name: "Deploy Sekarang" });
  expect(button.className).toContain("bg-green-600");

  fireEvent.click(button);

  expect(
    screen.getByText(/akan melakukan commit dan push kode lokal Anda ke repository/),
  ).toBeInTheDocument();
  expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/actions/deploy");

  fireEvent.click(screen.getByRole("button", { name: "Ya, deploy sekarang" }));

  await waitFor(() =>
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/actions/deploy"),
  );
});
