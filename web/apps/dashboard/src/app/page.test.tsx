import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { AppShell, StatusProvider } from "@/components/app-shell";
import type { SessionUser } from "@/lib/current-user";
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

test("topbar never repeats the H1 or product name and carries no second connection indicator", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(
    <AppShell user={{ login: "alif", name: "Alif", image: null } as SessionUser}>
      <DashboardPage />
    </AppShell>,
  );

  const banner = within(screen.getByRole("banner"));

  // Indikator "Server Online" hanya ada di footer sidebar. Root route tidak punya
  // judul breadcrumb karena nama produk sudah di sidebar dan "Dashboard" adalah H1.
  expect(banner.queryByRole("status")).toBeNull();
  expect(banner.queryByText("Terhubung")).toBeNull();
  expect(banner.queryByRole("heading")).toBeNull();
  expect(banner.queryByText("Dashboard", { selector: "p" })).toBeNull();
  expect(banner.queryByText("Autore", { selector: "p" })).toBeNull();
});
const STATUS = {
  system_status: "idle",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 0 },
  repository_health: { score_percent: 100, total_repos: 1, gold: 1, silver: 0, bronze: 0 },
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

const RUNS = {
  generated_at: "2026-11-04T10:10:00Z",
  window_days: 7,
  runs: [
    {
      app: "tes-web",
      number: 9,
      status: "passed",
      duration_ms: 45_555,
      started_at: "2026-11-04T10:06:06Z",
      commit_sha: "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2",
      author: "Autore CLI <autore@tugu-re.com>",
      url: "http://100.80.3.14:8080/job/tes-web/9",
    },
  ],
  daily: [
    { date: "2026-11-03", passed: 0, failed: 0 },
    { date: "2026-11-04", passed: 4, failed: 1 },
  ],
  totals: { passed: 4, failed: 1, running: 0 },
};

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function stubApi(runs: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/status") return ok({ data: STATUS, stale: false });
      if (url === "/api/runs") return runs();
      if (url === "/api/active") {
        return ok({
          data: { generated_at: "", active: [], counts: { running: 0, queued: 0 } },
          stale: false,
        });
      }
      throw new Error(`permintaan tidak terduga: ${url}`);
    }),
  );
}

test("Overview menampilkan tren, distribusi, dan recent runs", async () => {
  stubApi(async () => ok({ data: RUNS, stale: false }));

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  expect(await screen.findByText("Tren 7 Hari")).toBeInTheDocument();
  expect(screen.getByText("Distribusi")).toBeInTheDocument();
  expect(screen.getByText("Recent Runs")).toBeInTheDocument();
  expect(await screen.findByText("tes-web #9")).toBeInTheDocument();
});

test("Overview tetap tampil saat /api/runs gagal", async () => {
  stubApi(async () => {
    throw new Error("runs tidak tersedia");
  });

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  expect(await screen.findByText("Belum ada build dalam 7 hari terakhir")).toBeInTheDocument();
  expect(screen.getByText("Belum ada run")).toBeInTheDocument();
  expect(screen.getByText("Aplikasi")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
});

test("menandai data terakhir saat /api/runs menjawab stale", async () => {
  stubApi(async () => ok({ data: RUNS, stale: true }));

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  expect(await screen.findByText("data terakhir")).toBeInTheDocument();
});

test("Overview menampilkan section Active Pipelines beserta hitungannya", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/status") return ok({ data: STATUS, stale: false });
      if (url === "/api/runs") return ok({ data: RUNS, stale: false });
      if (url === "/api/active") {
        return ok({
          data: {
            generated_at: "2026-11-05T03:40:00Z",
            active: [
              {
                app: "tes-web",
                number: 42,
                status: "running",
                branch: "main",
                commit_sha: "3878d9307475eb84316edde4e77f63fd0b98ae4e",
                author: "Alif Fadlan <alif@example.test>",
                started_at: "2026-11-05T03:23:08Z",
                url: "http://100.80.3.14:8080/job/tes-web/42",
              },
            ],
            counts: { running: 1, queued: 0 },
          },
          stale: false,
        });
      }
      throw new Error(`permintaan tidak terduga: ${url}`);
    }),
  );

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  expect(await screen.findByRole("heading", { name: "Active Pipelines" })).toBeInTheDocument();
  // `findByText`, bukan `getByText`: judul section tampil sebelum /api/active
  // selesai, jadi assertion sinkron di sini balapan dengan respons fetch.
  expect(await screen.findByText("1 berjalan atau menunggu")).toBeInTheDocument();
  expect(await screen.findByTestId("pipeline-card")).toBeInTheDocument();
});

test("Overview tidak lagi punya tombol deploy tanpa konteks aplikasi", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input) === "/api/status" ? { data: STATUS, stale: false } : { data: null, stale: false };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Deploy Sekarang/ })).toBeNull();
});

test("Sync menukar angka di layar ke payload baru, tanpa reload", async () => {
  let tarikanStatus = 0;
  let tarikanRuns = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/status") {
        tarikanStatus += 1;
        const emas = tarikanStatus > 1;
        return ok({
          data: {
            ...STATUS,
            repository_health: {
              score_percent: emas ? 10 : 0,
              total_repos: 10,
              gold: emas ? 1 : 0,
              silver: 0,
              bronze: emas ? 9 : 10,
            },
          },
          stale: false,
        });
      }
      if (url === "/api/runs") {
        tarikanRuns += 1;
        return ok({ data: { ...RUNS, runs: [{ ...RUNS.runs[0], number: tarikanRuns > 1 ? 21 : 9 }] }, stale: false });
      }
      if (url === "/api/active") {
        return ok({
          data: { generated_at: "", active: [], counts: { running: 0, queued: 0 } },
          stale: false,
        });
      }
      throw new Error(`permintaan tidak terduga: ${url}`);
    }),
  );

  render(
    <AppShell user={{ login: "alif", name: "Alif", image: null } as SessionUser}>
      <DashboardPage />
    </AppShell>,
  );

  expect(await screen.findByText("0%")).toBeInTheDocument();
  expect(await screen.findByText("tes-web #9")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Sync" }));

  expect(await screen.findByText("10%")).toBeInTheDocument();
  expect(await screen.findByText("tes-web #21")).toBeInTheDocument();
  expect(await screen.findByText("Data berhasil disinkronkan.")).toBeInTheDocument();
});

test("Overview menyapa user dengan login GitHub apa adanya", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(
    <AppShell user={{ login: "MAliffadlan", name: "", image: null } as SessionUser}>
      <DashboardPage />
    </AppShell>,
  );

  expect(screen.getByText(/Selamat datang, MAliffadlan/)).toBeInTheDocument();
});

test("Overview tidak mengarang sapaan saat tidak ada user (halaman auth)", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  expect(screen.queryByText(/Selamat datang/)).toBeNull();
  expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
});

test("header meletakkan judul dan sapaan sejajar secara horizontal dengan pemisah dan jarak proporsional", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(
    <AppShell user={{ login: "MAliffadlan", name: "", image: null } as SessionUser}>
      <DashboardPage />
    </AppShell>,
  );

  const heading = screen.getByRole("heading", { name: "Dashboard" });
  const container = heading.parentElement;
  expect(container?.className).toContain("flex");
  expect(container?.className).toContain("items-center");
  expect(container?.className).toMatch(/gap-(4|5)/);
  expect(container?.className).toMatch(/mb-(6|8)/);

  const separator = screen.getByTestId("header-separator");
  expect(separator).toBeInTheDocument();
  expect(separator.className).toContain("text-gray-300");

  const greeting = screen.getByText("Selamat datang, MAliffadlan.");
  expect(greeting.className).toContain("text-gray-500");
});
