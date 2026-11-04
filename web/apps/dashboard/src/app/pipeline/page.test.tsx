import { render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const nav = vi.hoisted(() => ({ params: new URLSearchParams("app=portal-klaim") }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/pipeline",
  useSearchParams: () => nav.params,
}));

import { StatusProvider } from "@/components/app-shell";
import PipelinePage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
  nav.params = new URLSearchParams("app=portal-klaim");
});

const status = {
  system_status: "passed",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 1 },
  applications: [
    {
      id: "portal-klaim",
      name: "Portal Klaim",
      status: "passed",
      last_build: "2026-11-03T10:00:00Z",
      commit_sha: "405156b",
      security_issues: 0,
    },
  ],
  latest_pipeline: {
    status: "passed",
    failure_reason: "",
    stages: ["checkout", "scan", "build", "pasang", "periksa"],
    security_summary: "Tidak ada temuan keamanan.",
    commit_sha: "405156b",
    author: "Mectov",
    raw_log: ["Pipeline selesai tanpa error."],
  },
};

const failing = {
  ...status,
  latest_pipeline: {
    ...status.latest_pipeline,
    status: "failed",
    failure_reason: "Gitleaks menemukan rahasia.",
    stages: ["checkout", "scan", "build"],
  },
};

function mockFetch(data: unknown, stale = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data, stale }) } as unknown as Response),
  );
}

const renderPage = () =>
  render(
    <StatusProvider>
      <PipelinePage />
    </StatusProvider>,
  );

test("shows the live pipeline as a vertical timeline beside the detail log panel", async () => {
  mockFetch(status);

  renderPage();

  expect(await screen.findByRole("heading", { name: "Detail Pipeline" })).toBeVisible();

  const timeline = screen.getByRole("list", { name: "Tahapan pipeline" });
  expect(within(timeline).getAllByRole("listitem").map((row) => row.textContent)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Checkout"),
      expect.stringContaining("Security Scan"),
      expect.stringContaining("Build"),
      expect.stringContaining("Push"),
      expect.stringContaining("Deploy"),
    ]),
  );

  const logs = screen.getByRole("region", { name: "Detail Log" });
  expect(within(logs).getByText("Pipeline selesai tanpa error.")).toBeVisible();

  // The log lives in the right panel now, so the modal trigger is gone.
  expect(screen.queryByRole("button", { name: "Lihat Log Lengkap" })).toBeNull();
});

test("names the selected application in the subtitle while data stays the global pipeline", async () => {
  mockFetch(status);

  renderPage();

  expect(await screen.findByText("Portal Klaim · data pipeline terakhir workspace")).toBeVisible();
});

test("keeps the failure reason as an alert above the timeline", async () => {
  mockFetch(failing);

  renderPage();

  const alert = await screen.findByText("Gitleaks menemukan rahasia.");
  expect(alert).toHaveAttribute("role", "alert");
  const timeline = screen.getByRole("list", { name: "Tahapan pipeline" });
  expect(alert.compareDocumentPosition(timeline)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test("still renders previous details with the stale banner when the CLI stops answering", async () => {
  mockFetch(status, true);

  renderPage();

  expect(
    await screen.findByText("Gagal terhubung ke Jenkins. Menampilkan data terakhir."),
  ).toBeVisible();
  const logs = screen.getByRole("region", { name: "Detail Log" });
  expect(within(logs).getByText("Pipeline selesai tanpa error.")).toBeVisible();
});

test("keeps unrun stages neutral and appends unknown stage ids without guessing", async () => {
  mockFetch({
    ...status,
    latest_pipeline: { ...status.latest_pipeline, status: "running", stages: ["checkout", "lint"] },
  });

  renderPage();

  const rows = await screen.findAllByRole("listitem");
  expect(rows.at(-1)?.textContent).toContain("lint");
  expect(rows.at(-1)?.textContent).toContain("berjalan");
  expect(rows).toHaveLength(6);
});

test("shows the exact empty-pipeline copy when nothing ran", async () => {
  mockFetch({
    ...status,
    latest_pipeline: { ...status.latest_pipeline, status: "idle", stages: [], raw_log: [] },
  });

  renderPage();

  expect(await screen.findByText("Tidak ada data pipeline untuk ditampilkan.")).toBeVisible();
});

test("stays neutral for an unknown app id", async () => {
  nav.params = new URLSearchParams("app=tidak-ada");
  mockFetch(status);

  renderPage();

  expect(await screen.findByText(/tidak ditemukan/i)).toBeVisible();
  expect(screen.queryByRole("list", { name: "Tahapan pipeline" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Detail Log" })).toBeNull();
});

test("asks for an application when none is selected", async () => {
  nav.params = new URLSearchParams();
  mockFetch(status);

  renderPage();

  expect(await screen.findByText("Tidak ada aplikasi yang dipilih.")).toBeVisible();
});
