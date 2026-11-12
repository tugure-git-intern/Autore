import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const nav = vi.hoisted(() => ({ params: new URLSearchParams("app=portal-klaim") }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/pipeline",
  useSearchParams: () => nav.params,
  useRouter: () => router,
}));

import { StatusProvider } from "@/components/app-shell";
import PipelinePage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  nav.params = new URLSearchParams("app=portal-klaim");
});

const status = {
  system_status: "passed",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 1 },
  repository_health: { score_percent: 0, total_repos: 1, gold: 0, silver: 0, bronze: 1 },
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
  // Pipeline gagal hanya boleh tampil sebagai milik aplikasi yang memang gagal.
  applications: [{ ...status.applications[0], status: "failed" }],
  latest_pipeline: {
    ...status.latest_pipeline,
    status: "failed",
    failure_reason: "Gitleaks menemukan rahasia.",
    stages: ["checkout", "scan", "build"],
  },
};

const appUji = (id: string) => ({ ...status.applications[0], id, name: id });

function mockFetch(data: unknown, stale = false) {
  const kosong = {
    data: { generated_at: "", window_days: 7, runs: [], daily: [], totals: { passed: 0, failed: 0, running: 0 } },
    stale: false,
  };
  const tanpaAktif = { data: { generated_at: "", active: [], counts: { running: 0, queued: 0 } }, stale: false };

  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const jalur = String(input);
    const body =
      jalur === "/api/status"
        ? { data, stale }
        : jalur === "/api/runs"
          ? kosong
          : jalur === "/api/active"
            ? tanpaAktif
            : { ok: true, action: "deploy", target: "tes-web" };
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const renderPage = () =>
  render(
    <StatusProvider>
      <PipelinePage />
    </StatusProvider>,
  );


test("kartu isi tanpa bingkai: putihnya menyatu dengan kanvas", async () => {
  mockFetch(status);

  const { container } = renderPage();
  await screen.findByRole("heading", { name: "Detail Pipeline" });

  const kartu = container.querySelector("[class*='rounded-b-xl']") as HTMLElement;
  expect(kartu).toBeTruthy();
  expect(kartu.className).not.toContain("border");
});

test("shows the live pipeline as a card matrix beside the detail log panel", async () => {
  mockFetch(status);

  renderPage();

  expect(await screen.findByRole("heading", { name: "Detail Pipeline" })).toBeVisible();

  const matriks = screen.getByRole("list", { name: "Tahapan pipeline" });
  expect(within(matriks).getAllByTestId("stage-card")).toHaveLength(5);
  expect(within(matriks).getAllByRole("listitem").map((row) => row.textContent)).toEqual(
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

  expect(await screen.findByText("Portal Klaim · portal-klaim")).toBeVisible();
});

test("menyembunyikan tahapan pipeline saat commit-nya bukan milik aplikasi terpilih", async () => {
  mockFetch({ ...status, latest_pipeline: { ...status.latest_pipeline, commit_sha: "deadbee" } });

  renderPage();

  expect(await screen.findByText(/bukan milik Portal Klaim/)).toBeVisible();
  expect(screen.queryByRole("list", { name: "Tahapan pipeline" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Detail Log" })).toBeNull();
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
    await screen.findByText("Data terakhir ditampilkan; status terbaru belum terbaca."),
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

  const kartu = await screen.findAllByTestId("stage-card");
  expect(kartu).toHaveLength(2);
  expect(kartu.at(-1)?.textContent).toContain("lint");
  expect(kartu.at(-1)?.textContent).toContain("Berjalan");
  expect(kartu[0].textContent).toContain("Lulus");
});

test("memakai durasi nyata dari stage_times, bukan angka karangan", async () => {
  mockFetch({
    ...status,
    latest_pipeline: {
      ...status.latest_pipeline,
      stage_times: [
        { id: "checkout", at: "2026-11-04T10:00:00Z" },
        { id: "scan", at: "2026-11-04T10:00:30Z" },
        { id: "build", at: "2026-11-04T10:01:30Z" },
      ],
      finished_at: "2026-11-04T10:02:00Z",
    },
  });

  renderPage();

  const kartu = await screen.findAllByTestId("stage-card");
  expect(kartu).toHaveLength(3);
  expect(kartu[0].textContent).toContain("30.0s");
  expect(kartu[1].textContent).toContain("1m 0s");
  expect(kartu[2].textContent).toContain("30.0s");
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

test("tanpa ?app= halaman langsung memilih aplikasi, bukan menyuruh user memilih", async () => {
  nav.params = new URLSearchParams();
  mockFetch(status);

  renderPage();

  expect(await screen.findByRole("heading", { name: "Detail Pipeline" })).toBeVisible();
  expect(screen.queryByText("Tidak ada aplikasi yang dipilih.")).toBeNull();
});

test("tanpa ?app= yang diutamakan adalah aplikasi gagal, supaya yang rusak langsung terlihat", async () => {
  nav.params = new URLSearchParams();
  mockFetch({
    ...status,
    applications: [
      status.applications[0],
      { ...status.applications[0], id: "app-rusak", name: "App Rusak", status: "failed" },
    ],
  });

  renderPage();

  expect(await screen.findByText("App Rusak · app-rusak")).toBeVisible();
});

test("memilih aplikasi lain menulis ?app= lewat replace, bukan menumpuk riwayat", async () => {
  nav.params = new URLSearchParams();
  mockFetch({
    ...status,
    applications: [
      status.applications[0],
      { ...status.applications[0], id: "app-dua", name: "App Dua" },
    ],
  });

  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: /App Dua/ }));

  expect(router.replace).toHaveBeenCalledWith("/pipeline?app=app-dua", { scroll: false });
  expect(router.push).not.toHaveBeenCalled();
});

test("menampilkan daftar aplikasi di sisi kiri dan menyembunyikannya saat detail dibuka di layar sempit", async () => {
  mockFetch(status);

  renderPage();

  expect(await screen.findByRole("navigation", { name: "Daftar aplikasi" })).toBeVisible();
  expect(screen.getByTestId("panel-daftar")).toHaveClass("hidden");

  fireEvent.click(screen.getByRole("button", { name: /Daftar aplikasi/ }));

  expect(screen.getByTestId("panel-daftar")).not.toHaveClass("hidden");
});

test("menyediakan Jalankan Ulang yang memperingatkan commit dan push sebelum memicu Jenkins", async () => {
  const fetchMock = mockFetch(status);

  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: "Jalankan Ulang" }));

  expect(
    screen.getByText(/akan melakukan commit dan push kode lokal Anda ke repository/),
  ).toBeInTheDocument();
  expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/actions/deploy");

  fireEvent.click(screen.getByRole("button", { name: "Ya, jalankan ulang" }));

  await waitFor(() =>
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/actions/deploy"),
  );
});

/** Klik Jalankan Ulang untuk id tertentu, lalu kembalikan body POST-nya. */
async function bodyDeployUntuk(id: string, fetchMock: ReturnType<typeof mockFetch>) {
  nav.params = new URLSearchParams(`app=${id}`);
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: "Jalankan Ulang" }));
  fireEvent.click(screen.getByRole("button", { name: "Ya, jalankan ulang" }));

  const panggilan = await vi.waitFor(() => {
    const ketemu = fetchMock.mock.calls.find(([input]) => String(input) === "/api/actions/deploy");
    expect(ketemu).toBeTruthy();
    return ketemu;
  });
  const [, init] = panggilan as unknown as [string, RequestInit];
  return JSON.parse(String(init.body));
}

test("Jalankan Ulang mengirim aplikasi yang sedang dibuka (audit-uji3)", async () => {
  const fetchMock = mockFetch({ ...status, applications: [appUji("audit-uji3"), appUji("tes-web")] });

  expect(await bodyDeployUntuk("audit-uji3", fetchMock)).toEqual({ app: "audit-uji3" });
});

test("Jalankan Ulang mengikuti aplikasi kedua, jadi targetnya bukan hardcode", async () => {
  const fetchMock = mockFetch({ ...status, applications: [appUji("audit-uji3"), appUji("tes-web")] });

  expect(await bodyDeployUntuk("tes-web", fetchMock)).toEqual({ app: "tes-web" });
});
