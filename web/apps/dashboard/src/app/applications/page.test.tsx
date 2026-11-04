import { render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/applications",
  useSearchParams: () => new URLSearchParams(),
}));

import { StatusProvider } from "@/components/app-shell";
import ApplicationsPage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

const EMPTY = {
  data: {
    system_status: "idle",
    infra: { jenkins: "active", nexus: "active" },
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
  stale: false,
};

test("states the empty fact once: the subtitle carries the count", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => EMPTY } as unknown as Response),
  );

  render(
    <StatusProvider>
      <ApplicationsPage />
    </StatusProvider>,
  );

  expect(await screen.findByText("Belum ada aplikasi yang didaftarkan.")).toBeVisible();
  expect(screen.getByText(/0 aplikasi terdaftar/)).toBeVisible();
  expect(screen.queryByText(/Daftarkan aplikasi lewat CLI Autore/)).toBeNull();
  expect(screen.queryByText(/autore status --json/)).toBeNull();
});
