import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

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
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input) === "/api/status" ? payload : { ok: true, action: "scan", target: "x" };
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Layar HP: satu-satunya cara halaman tahu lebarnya (jsdom tidak punya layout). */
function pasangLayarSempit() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
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

test("memberi tombol Scan Keamanan per baris dan mengirim id baris itu saja", async () => {
  const fetchMock = mockFetch(TWO_APPS);

  renderPage();

  const rows = await screen.findAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(screen.getAllByRole("button", { name: "Scan Keamanan" })).toHaveLength(2);

  const apiRow = rows.find((row) => row.textContent?.includes("API Pegawai"))!;
  fireEvent.click(within(apiRow).getByRole("button", { name: "Scan Keamanan" }));

  await waitFor(() =>
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/actions/scan"),
  );
  const call = fetchMock.mock.calls.find(([input]) => String(input) === "/api/actions/scan") as unknown as [
    string,
    RequestInit,
  ];
  expect(JSON.parse(String(call[1].body))).toEqual({ app: "api-pegawai" });
});

const TIGA_APPS = {
  data: {
    ...EMPTY.data,
    stats: { total_apps: 3, running_containers: 1 },
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
      app({ id: "ui-demo-lama", name: "Demo Lama", status: "unknown", last_build: "", commit_sha: "" }),
    ],
  },
  stale: false,
};

const isiFilter = (nama: string, nilai: string) =>
  fireEvent.change(screen.getByRole(nama === "Cari aplikasi" ? "searchbox" : "combobox", { name: nama }), {
    target: { value: nilai },
  });

test("mengetik di pencarian menyaring tabel dan menghitung hasilnya", async () => {
  mockFetch(TIGA_APPS);

  renderPage();

  expect(await screen.findByText("Portal Klaim")).toBeVisible();

  isiFilter("Cari aplikasi", "demo");

  expect(screen.queryByText("Portal Klaim")).toBeNull();
  expect(screen.getByText("Demo Lama")).toBeVisible();
  expect(screen.getByText("1 dari 3 aplikasi")).toBeVisible();
});

test("dropdown status menyaring, dan Unknown tetap tampil untuk aplikasi registry-only", async () => {
  mockFetch(TIGA_APPS);

  renderPage();

  expect(await screen.findByText("Portal Klaim")).toBeVisible();

  isiFilter("Status", "failed");
  expect(screen.queryByText("Portal Klaim")).toBeNull();
  expect(screen.getByText("API Pegawai")).toBeVisible();

  isiFilter("Status", "unknown");
  expect(screen.getByText("Demo Lama")).toBeVisible();
  expect(screen.getByText("1 dari 3 aplikasi")).toBeVisible();
});

test("empty state saat pencarian tidak menemukan apa pun", async () => {
  mockFetch(TIGA_APPS);

  renderPage();

  expect(await screen.findByText("Portal Klaim")).toBeVisible();

  isiFilter("Cari aplikasi", "zzz");

  expect(screen.getByText("Tidak ada aplikasi yang cocok")).toBeVisible();
  expect(screen.getByText("0 dari 3 aplikasi")).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
});

test("memberi tautan Lihat SBOM per baris ke halaman SBOM aplikasi itu", async () => {
  mockFetch({
    ...TWO_APPS,
    data: {
      ...TWO_APPS.data,
      applications: [...TWO_APPS.data.applications, app({ id: "app satu/dua#tiga", name: "Aneh" })],
    },
  });

  renderPage();

  expect(await screen.findByText("Aneh")).toBeVisible();
  expect(screen.getAllByRole("link", { name: "Lihat SBOM" }).map((link) => link.getAttribute("href"))).toEqual([
    "/applications/sbom?app=portal-klaim",
    "/applications/sbom?app=api-pegawai",
    "/applications/sbom?app=app%20satu%2Fdua%23tiga",
  ]);
});

test("daftar kosong tidak memunculkan tautan Lihat SBOM", async () => {
  mockFetch(EMPTY);

  renderPage();

  expect(await screen.findByText("Belum ada aplikasi yang didaftarkan.")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Lihat SBOM" })).toBeNull();
});

test("menyediakan tombol buat aplikasi baru di kepala halaman", async () => {
  mockFetch(TWO_APPS);

  renderPage();

  expect(await screen.findByRole("button", { name: /Buat Aplikasi Baru/ })).toBeVisible();
});

test("tombol buat aplikasi tetap ada saat daftar masih kosong", async () => {
  mockFetch(EMPTY);

  renderPage();

  expect(await screen.findByText("Belum ada aplikasi yang didaftarkan.")).toBeVisible();
  expect(screen.getByRole("button", { name: /Buat Aplikasi Baru/ })).toBeVisible();
});

test("menampilkan 'Dibuat oleh' dari audit trail kalau CLI mengirim author", async () => {
  mockFetch({
    ...TWO_APPS,
    data: {
      ...TWO_APPS.data,
      applications: [app({ author: "Alif Fadlan <alif@example.com>" })],
    },
  });

  renderPage();

  expect(await screen.findByText("Dibuat oleh: Alif Fadlan <alif@example.com>")).toBeVisible();
});

test("tidak mengarang 'Dibuat oleh' saat snapshot lama belum punya author", async () => {
  mockFetch(TWO_APPS);

  renderPage();

  expect(await screen.findByText("Portal Klaim")).toBeVisible();
  expect(screen.queryByText(/Dibuat oleh/)).toBeNull();
});

describe("ApplicationsPage di layar HP", () => {
  test("mengganti tabel dengan kartu: satu kartu per aplikasi, tanpa tabel", async () => {
    pasangLayarSempit();
    mockFetch(TWO_APPS);

    renderPage();

    expect(await screen.findByText("Portal Klaim")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("columnheader")).toBeNull();

    const kartu = screen.getAllByTestId("kartu-aplikasi");
    expect(kartu).toHaveLength(2);

    const kartuApi = kartu.find((k) => k.textContent?.includes("API Pegawai"))!;
    expect(kartuApi.textContent).toContain("2 temuan");
    expect(within(kartuApi).getByRole("alert")).toHaveTextContent("Gagal");
    expect(kartuApi.textContent).toContain("Terakhir update");
  });

  test("kartu membawa aksi yang sama dengan tabel, targetnya 44px", async () => {
    pasangLayarSempit();
    const fetchMock = mockFetch(TWO_APPS);

    renderPage();

    expect(await screen.findByText("Portal Klaim")).toBeVisible();

    const tautan = screen.getAllByRole("link", { name: "Detail" });
    expect(tautan.map((t) => t.getAttribute("href"))).toEqual([
      "/pipeline?app=portal-klaim",
      "/pipeline?app=api-pegawai",
    ]);
    for (const t of tautan) expect(t.className).toContain("min-h-11");

    const kartuApi = screen.getAllByTestId("kartu-aplikasi").find((k) => k.textContent?.includes("API Pegawai"))!;
    fireEvent.click(within(kartuApi).getByRole("button", { name: "Scan Keamanan" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/actions/scan"),
    );
    const call = fetchMock.mock.calls.find(([input]) => String(input) === "/api/actions/scan") as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(call[1].body))).toEqual({ app: "api-pegawai" });
  });

  test("penyaring tetap menyaring daftar kartu", async () => {
    pasangLayarSempit();
    mockFetch(TIGA_APPS);

    renderPage();

    expect(await screen.findByText("Portal Klaim")).toBeVisible();

    isiFilter("Cari aplikasi", "demo");

    expect(screen.getAllByTestId("kartu-aplikasi")).toHaveLength(1);
    expect(screen.getByText("Demo Lama")).toBeVisible();
  });
});
