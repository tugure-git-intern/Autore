import { render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

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

const app = (over: Record<string, unknown> = {}) => ({
  id: "portal-klaim",
  name: "Portal Klaim",
  status: "passed",
  last_build: "2026-11-03T10:00:00Z",
  commit_sha: "405156b",
  security_issues: 0,
  ...over,
});

const TWO_APPS = {
  data: {
    ...EMPTY.data,
    stats: { total_apps: 2, running_containers: 1 },
    applications: [
      app(),
      app({
        id: "api-pegawai",
        name: "API Pegawai",
        status: "failed",
        last_build: "",
        commit_sha: "",
        security_issues: 2,
      }),
    ],
  },
  stale: false,
};

function mockFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload } as unknown as Response),
  );
}

const renderPage = () =>
  render(
    <StatusProvider>
      <ApplicationsPage />
    </StatusProvider>,
  );

test("states the empty fact once: the subtitle carries the count", async () => {
  mockFetch(EMPTY);

  renderPage();

  expect(await screen.findByText("Belum ada aplikasi yang didaftarkan.")).toBeVisible();
  expect(screen.getByText(/0 aplikasi terdaftar/)).toBeVisible();
  expect(screen.queryByText(/Daftarkan aplikasi lewat CLI Autore/)).toBeNull();
  expect(screen.queryByText(/autore status --json/)).toBeNull();
});

test("renders exactly the four requested columns, with status and findings merged", async () => {
  mockFetch(TWO_APPS);

  renderPage();

  expect(await screen.findByText("Portal Klaim")).toBeVisible();
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Nama",
    "Status Keamanan",
    "Terakhir Update",
    "Aksi",
  ]);

  const rows = screen.getAllByRole("row");
  const rowFor = (name: string) => rows.find((row) => row.textContent?.includes(name))!;

  const passedCells = within(rowFor("Portal Klaim")).getAllByRole("cell");
  expect(passedCells[1].textContent).toContain("Lulus");
  expect(passedCells[1].textContent).toContain("0 temuan");

  const failedCells = within(rowFor("API Pegawai")).getAllByRole("cell");
  expect(failedCells[1].textContent).toContain("Gagal");
  expect(failedCells[1].textContent).toContain("2 temuan");
  expect(failedCells[2].textContent).toBe("—");
});

test("keeps a registry-only application neutral: no scan means no findings claim", async () => {
  mockFetch({
    ...TWO_APPS,
    data: {
      ...TWO_APPS.data,
      applications: [
        ...TWO_APPS.data.applications,
        app({ id: "app-baru", name: "App Baru", status: "unknown", last_build: "", security_issues: 0 }),
      ],
    },
  });

  renderPage();

  expect(await screen.findByText("App Baru")).toBeVisible();
  const rows = screen.getAllByRole("row");
  const cells = within(rows.find((row) => row.textContent?.includes("App Baru"))!).getAllByRole("cell");

  expect(cells[1].textContent).toContain("Belum ada hasil scan");
  expect(cells[1].textContent).not.toContain("0 temuan");
  expect(cells[2].textContent).toBe("—");
});

test("links each row to its pipeline route with the app id encoded", async () => {
  mockFetch({
    ...TWO_APPS,
    data: {
      ...TWO_APPS.data,
      applications: [...TWO_APPS.data.applications, app({ id: "app satu/dua#tiga", name: "Aneh" })],
    },
  });

  renderPage();

  expect(await screen.findByText("Aneh")).toBeVisible();
  expect(screen.getAllByRole("link", { name: "Detail" }).map((link) => link.getAttribute("href"))).toEqual([
    "/pipeline?app=portal-klaim",
    "/pipeline?app=api-pegawai",
    "/pipeline?app=app%20satu%2Fdua%23tiga",
  ]);
});
