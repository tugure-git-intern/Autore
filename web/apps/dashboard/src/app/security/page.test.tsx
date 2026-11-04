import { render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/security",
  useSearchParams: () => new URLSearchParams(),
}));

import { StatusProvider } from "@/components/app-shell";
import SecurityPage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

const app = (over: Record<string, unknown> = {}) => ({
  id: "tes-web",
  name: "Tes Web",
  status: "passed",
  last_build: "2026-11-04T10:00:00Z",
  commit_sha: "2dfd6ef",
  security_issues: 0,
  ...over,
});

const STATUS = {
  data: {
    system_status: "passed",
    infra: { jenkins: "active", nexus: "active" },
    stats: { total_apps: 2, running_containers: 1 },
    applications: [app(), app({ id: "api-pegawai", name: "API Pegawai", status: "failed", security_issues: 2 })],
    latest_pipeline: {
      status: "passed",
      failure_reason: "",
      stages: ["checkout", "scan"],
      gates_passed: 3,
      gates_total: 5,
      security_summary: "Gitleaks: 2 temuan.",
      commit_sha: "2dfd6ef",
      author: "Autore",
      raw_log: [],
    },
  },
  stale: false,
};

const RUNS = {
  data: {
    generated_at: "2026-11-04T10:10:00Z",
    window_days: 7,
    runs: [
      {
        app: "tes-web",
        number: 10,
        status: "passed",
        duration_ms: 45_000,
        started_at: new Date(Date.now() - 3_600_000).toISOString(),
        commit_sha: "2dfd6ef",
        author: "",
        url: "",
      },
    ],
    daily: [],
    totals: { passed: 1, failed: 0, running: 0 },
  },
  stale: false,
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function mockApi(runs: () => Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/status") return ok(STATUS);
    if (url === "/api/runs") return runs();
    throw new Error(`permintaan tidak terduga: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const renderPage = () =>
  render(
    <StatusProvider>
      <SecurityPage />
    </StatusProvider>,
  );

test("menampilkan gerbang, temuan per aplikasi, dan catatan kaki yang jujur", async () => {
  mockApi(async () => ok(RUNS));

  renderPage();

  expect(await screen.findByRole("heading", { name: "Keamanan" })).toBeVisible();
  expect(await screen.findByText("3/5")).toBeVisible();
  expect(screen.getByText("Gitleaks: 2 temuan.")).toBeVisible();

  const baris = screen.getByText("API Pegawai").closest("tr") as HTMLElement;
  expect(within(baris).getByText("2 temuan")).toBeVisible();
  expect(within(baris).getByRole("alert")).toHaveTextContent("Gagal");

  expect(screen.queryByText("Tes Web")).toBeNull();
  expect(
    screen.getByText("Skor dihitung dari data pipeline yang ada; sumbu tanpa data tidak ditampilkan."),
  ).toBeVisible();
});

test("radar memakai sumbu terukur dan tetap tampil saat /api/runs gagal", async () => {
  mockApi(async () => {
    throw new Error("runs tidak tersedia");
  });

  renderPage();

  expect(await screen.findByText("3/5")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Skor Pipeline" })).toBeVisible();
  expect(screen.queryByText("Belum ada data untuk dinilai")).toBeNull();
});

test("tanpa gerbang dan tanpa run, radar kosong bukan angka karangan", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/status"
        ? ok({
            data: {
              ...STATUS.data,
              applications: [],
              latest_pipeline: { ...STATUS.data.latest_pipeline, gates_passed: 0, gates_total: 0, security_summary: "" },
            },
            stale: false,
          })
        : ok({ data: { ...RUNS.data, runs: [], totals: { passed: 0, failed: 0, running: 0 } }, stale: false }),
    ),
  );

  renderPage();

  expect(await screen.findByText("0/0")).toBeVisible();
  expect(screen.getByText("Belum ada ringkasan keamanan yang tercatat.")).toBeVisible();
  expect(screen.getByText("Tidak ada temuan keamanan tercatat")).toBeVisible();
  expect(screen.queryByText("0/0")?.textContent).not.toContain("NaN");
});
