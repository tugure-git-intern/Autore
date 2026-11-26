import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Deployment, Environment, Release } from "@autore/contracts";
import { ReleaseEnvironmentBoard, umurPersetujuan } from "./release-environment-board";

const fetchMock = vi.fn();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const digest = "sha256:" + "a".repeat(64);

const environments: Environment[] = [
  {
    id: "env-staging",
    application_id: "app-1",
    nama: "staging",
    target: "vps-staging",
    status_konfigurasi: "terkonfigurasi",
    active_deployment_id: "dep-staging",
  },
  {
    id: "env-production",
    application_id: "app-1",
    nama: "production",
    target: null,
    status_konfigurasi: "belum_dikonfigurasi",
    active_deployment_id: null,
  },
];

const releases: Release[] = [
  {
    id: "rel-1",
    application_id: "app-1",
    commit_sha: "0123456789abcdef0123456789abcdef01234567",
    image_digest: digest,
    status: "menunggu_persetujuan",
    approved_by: null,
    alasan: null,
    dibuat_oleh: "developer",
    dibuat_pada: "2026-11-12T06:00:00.000Z",
    commit_subject: null,
    branch: null,
    repo_url: null,
    menunggu_sejak: null,
  },
];

const deployments: Deployment[] = [
  {
    id: "dep-staging",
    release_id: "rel-1",
    environment_id: "env-staging",
    image_digest: digest,
    status: "sehat",
    health_check_url: "http://staging.internal/health",
    mulai_pada: "2026-11-12T06:01:00.000Z",
    selesai_pada: "2026-11-12T06:02:00.000Z",
    error: null,
  },
];

describe("ReleaseEnvironmentBoard", () => {
  it("menampilkan alasan penolakan kepada role dev", () => {
    const ditolak: Release[] = [{
      ...releases[0]!,
      status: "ditolak",
      alasan: "Perlu perbaiki validasi input sebelum rilis.",
    }];
    render(
      <ReleaseEnvironmentBoard
        releases={ditolak}
        environments={environments}
        deployments={deployments}
        role="dev"
      />,
    );

    expect(screen.getByTestId("release-alasan")).toHaveTextContent(
      "Alasan penolakan: Perlu perbaiki validasi input sebelum rilis.",
    );
  });

  it("menampilkan staging dan production pada satu dashboard", () => {
    render(<ReleaseEnvironmentBoard releases={releases} environments={environments} deployments={deployments} />);

    const board = screen.getByRole("region", { name: "Environment Portal Klaim" });
    expect(within(board).getByRole("heading", { name: "Staging" })).toBeVisible();
    expect(within(board).getByRole("heading", { name: "Production" })).toBeVisible();
  });

  it("menampilkan konteks koordinasi: subjek, branch, tautan commit, dan umur antrean", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T07:00:00Z"));
    const denganKonteks: Release[] = [{
      ...releases[0]!,
      commit_subject: "perbaiki login pelanggan",
      branch: "main",
      repo_url: "https://github.com/tugure-git-intern/tes-testing.git",
      menunggu_sejak: "2026-11-17T04:00:00Z",
    }];
    render(
      <ReleaseEnvironmentBoard
        releases={denganKonteks}
        environments={environments}
        deployments={deployments}
      />,
    );

    expect(screen.getByTestId("release-subjek")).toHaveTextContent("perbaiki login pelanggan");
    expect(screen.getByTestId("release-branch")).toHaveTextContent("main");
    expect(screen.getByTestId("release-commit-link")).toHaveAttribute(
      "href",
      "https://github.com/tugure-git-intern/tes-testing/commit/0123456789abcdef0123456789abcdef01234567",
    );
    expect(screen.getByTestId("release-tindakan")).toHaveTextContent("Perlu QA/Admin menyetujui");
    expect(screen.getByTestId("release-umur")).toHaveTextContent("menunggu 3 jam");
    vi.useRealTimers();
  });

  it("umurPersetujuan membulatkan menit, jam, dan hari", () => {
    const awal = "2026-11-17T04:00:00Z";
    const jam = Date.parse(awal) + 3 * 60 * 60 * 1000;
    expect(umurPersetujuan(awal, jam)).toBe("3 jam");
    expect(umurPersetujuan(awal, Date.parse(awal) + 90_000)).toBe("1 menit");
    expect(umurPersetujuan(awal, Date.parse(awal) + 2 * 24 * 60 * 60 * 1000)).toBe("2 hari");
    expect(umurPersetujuan(null)).toBeNull();
  });

  it("menampilkan production belum dikonfigurasi, bukan online", () => {
    render(<ReleaseEnvironmentBoard releases={releases} environments={environments} deployments={deployments} />);

    const production = screen.getByTestId("environment-production");
    expect(within(production).getByText("Belum dikonfigurasi")).toBeVisible();
    expect(within(production).queryByText("Online")).toBeNull();
    expect(within(production).getByText("Target production belum diisi oleh admin.")).toBeVisible();
  });

  it("menampilkan status release menunggu persetujuan setelah staging sehat", () => {
    render(<ReleaseEnvironmentBoard releases={releases} environments={environments} deployments={deployments} />);

    const staging = screen.getByTestId("environment-staging");
    expect(within(staging).getByText("Sehat")).toBeVisible();
    expect(screen.getByText("Menunggu Persetujuan")).toBeVisible();
    expect(screen.getByTestId("release-digest")).toHaveTextContent(`sha256:${"a".repeat(12)}...`);
    expect(screen.getByTestId("release-digest")).toHaveAttribute("title", digest);
  });

  it("membatasi daftar ke tiga rilis terbaru dan melipat sisanya", () => {
    const banyak = Array.from({ length: 5 }, (_, i) => ({
      ...releases[0]!,
      id: `rel-${i + 1}`,
      commit_subject: `subjek ${i + 1}`,
    }));
    render(
      <ReleaseEnvironmentBoard
        releases={banyak}
        environments={environments}
        deployments={deployments}
      />,
    );

    const terlihat = screen.getByLabelText("Release terbaru");
    expect(within(terlihat).getAllByRole("listitem")).toHaveLength(3);
    const lipat = screen.getByLabelText("Release sebelumnya").closest("details")!;
    expect(within(lipat).getAllByRole("listitem")).toHaveLength(2);
    expect(lipat).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Lihat semua 5 rilis"));
    expect(lipat).toHaveAttribute("open");
  });

  it("menandai deployment aktif dengan digest berbeda tanpa melempar", () => {
    const salah = [{ ...deployments[0]!, image_digest: "sha256:" + "b".repeat(64) }];
    render(
      <ReleaseEnvironmentBoard
        releases={releases}
        environments={environments.map((environment) => ({
          ...environment,
          active_deployment_id: environment.nama === "staging" ? salah[0]!.id : null,
        }))}
        deployments={salah}
      />,
    );

    expect(screen.getByTestId("deployment-inkonsisten")).toHaveTextContent(salah[0]!.id);
    expect(screen.getByTestId("deployment-inkonsisten")).toHaveTextContent("deployment aktif");
  });

  it("mengabaikan digest berbeda pada riwayat rollback yang tidak aktif", () => {
    const rollback = {
      ...deployments[0]!,
      id: "dep-rollback",
      release_id: "rel-rollback",
      image_digest: "sha256:" + "b".repeat(64),
    };
    const envTanpaDeploymentAktif = environments.map((environment) => ({
      ...environment,
      active_deployment_id: null,
    }));

    render(
      <ReleaseEnvironmentBoard
        releases={[...releases, { ...releases[0]!, id: "rel-rollback", image_digest: null }]}
        environments={envTanpaDeploymentAktif}
        deployments={[...deployments, rollback]}
      />,
    );

    expect(screen.queryByTestId("deployment-inkonsisten")).toBeNull();
  });

  it("memperingatkan deployment aktif yang release-nya tidak ada", () => {
    const tanpaRelease = { ...deployments[0]!, release_id: "rel-hilang" };
    render(
      <ReleaseEnvironmentBoard
        releases={releases}
        environments={environments.map((environment) => ({
          ...environment,
          active_deployment_id: environment.nama === "staging" ? tanpaRelease.id : null,
        }))}
        deployments={[tanpaRelease]}
      />,
    );

    expect(screen.getByTestId("deployment-inkonsisten")).toHaveTextContent(tanpaRelease.id);
  });

  it("memperingatkan deployment aktif dengan digest kosong", () => {
    const releaseKosong: Release[] = [{ ...releases[0]!, image_digest: null }];
    const deploymentKosong = deployments[0]!;
    render(
      <ReleaseEnvironmentBoard
        releases={releaseKosong}
        environments={environments.map((environment) => ({
          ...environment,
          active_deployment_id: environment.nama === "staging" ? deploymentKosong.id : null,
        }))}
        deployments={[deploymentKosong]}
      />,
    );

    expect(screen.getByTestId("deployment-inkonsisten")).toHaveTextContent(deploymentKosong.id);
  });

  it("menampilkan pembuat dan status approval pada kartu release", () => {
    render(<ReleaseEnvironmentBoard releases={releases} environments={environments} deployments={deployments} />);

    expect(screen.getByTestId("release-dibuat-oleh")).toHaveTextContent("developer");
    expect(screen.getByTestId("release-approved-by")).toHaveTextContent("belum disetujui");
  });

  it("menampilkan approver yang sudah mencatat keputusan", () => {
    const sudah = [{ ...releases[0], approved_by: "tugure-git-intern" }];
    render(<ReleaseEnvironmentBoard releases={sudah} environments={environments} deployments={deployments} />);

    expect(screen.getByTestId("release-approved-by")).toHaveTextContent("tugure-git-intern");
  });

  it("menyembunyikan tombol approval dari role dev", () => {
    render(
      <ReleaseEnvironmentBoard
        releases={releases}
        environments={environments}
        deployments={deployments}
        role="dev"
      />,
    );

    expect(screen.queryByRole("button", { name: "Setujui" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tolak" })).toBeNull();
  });

  it("menampilkan tombol approval untuk role qa saat release menunggu persetujuan", () => {
    render(
      <ReleaseEnvironmentBoard
        releases={releases}
        environments={environments}
        deployments={deployments}
        role="qa"
      />,
    );

    expect(screen.getByRole("button", { name: "Setujui" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Setujui" })).toHaveClass(
      "bg-[#496cc3]",
      "dark:bg-[#839cff]",
    );
    expect(screen.getByRole("button", { name: "Tolak" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Tolak" })).toHaveClass(
      "border-[#496cc3]/50",
      "dark:border-[#839cff]/50",
    );
  });

  it("menutup form penolakan lewat tombol Batal", () => {
    render(
      <ReleaseEnvironmentBoard
        releases={releases}
        environments={environments}
        deployments={deployments}
        role="qa"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tolak" }));
    expect(screen.getByLabelText("Alasan penolakan (wajib)")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(screen.queryByLabelText("Alasan penolakan (wajib)")).toBeNull();
  });

  it("tidak menawarkan approval untuk release yang sudah lewat gerbang", () => {
    const aktif = [{ ...releases[0], status: "aktif" as const, approved_by: "qa-satu" }];
    render(
      <ReleaseEnvironmentBoard
        releases={aktif}
        environments={environments}
        deployments={deployments}
        role="admin"
      />,
    );

    expect(screen.queryByRole("button", { name: "Setujui" })).toBeNull();
  });

  it("menampilkan tombol promosi untuk admin saat release disetujui", () => {
    const disetujui = [{ ...releases[0], status: "disetujui" as const, approved_by: "qa-satu" }];
    render(
      <ReleaseEnvironmentBoard
        releases={disetujui}
        environments={environments}
        deployments={deployments}
        role="admin"
      />,
    );

    expect(screen.getByRole("button", { name: "Promosikan ke Production" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Promosikan ke Production" })).toHaveClass(
      "bg-[#496cc3]",
      "dark:bg-[#839cff]",
    );
    expect(screen.queryByRole("button", { name: "Rollback Production" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Setujui" })).toBeNull();
  });

  it("menyembunyikan tombol promosi dari role qa", () => {
    const disetujui = [{ ...releases[0], status: "disetujui" as const }];
    render(
      <ReleaseEnvironmentBoard
        releases={disetujui}
        environments={environments}
        deployments={deployments}
        role="qa"
      />,
    );

    expect(screen.queryByRole("button", { name: "Promosikan ke Production" })).toBeNull();
  });

  it("menampilkan tombol rollback production untuk qa saat release aktif", () => {
    const aktif = [{ ...releases[0], status: "aktif" as const }];
    render(
      <ReleaseEnvironmentBoard
        releases={aktif}
        environments={environments}
        deployments={deployments}
        role="qa"
      />,
    );

    expect(screen.getByRole("button", { name: "Rollback Production" })).toBeVisible();
  });

  it("menyembunyikan tombol rollback dari role dev", () => {
    const aktif = [{ ...releases[0], status: "aktif" as const }];
    render(
      <ReleaseEnvironmentBoard
        releases={aktif}
        environments={environments}
        deployments={deployments}
        role="dev"
      />,
    );

    expect(screen.queryByRole("button", { name: "Rollback Production" })).toBeNull();
  });

  it("tidak menawarkan promosi atau rollback saat masih menunggu persetujuan", () => {
    render(
      <ReleaseEnvironmentBoard
        releases={releases}
        environments={environments}
        deployments={deployments}
        role="admin"
      />,
    );

    expect(screen.queryByRole("button", { name: "Promosikan ke Production" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rollback Production" })).toBeNull();
  });

  it("mengirim POST promosi ke endpoint release", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ job: "tes-testing-promote" }) });
    vi.stubGlobal("fetch", fetchMock);
    const disetujui = [{ ...releases[0], status: "disetujui" as const }];
    render(
      <ReleaseEnvironmentBoard
        releases={disetujui}
        environments={environments}
        deployments={deployments}
        role="admin"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Promosikan ke Production" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opsi] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/releases/rel-1/promote");
    expect(opsi.method).toBe("POST");
    expect(JSON.parse(String(opsi.body))).toEqual({});
    expect(await screen.findByRole("status")).toHaveTextContent("tes-testing-promote");
  });

  it("menandai release yang sudah digantikan build baru dan mematikan tombol Setujui", () => {
    const digestB = "sha256:" + "c".repeat(64);
    const duaRelease: Release[] = [
      { ...releases[0], id: "tes-testing:550e8400:36" },
      { ...releases[0], id: "tes-testing:550e8400:37", image_digest: digestB },
    ];
    const duaDeployment: Deployment[] = [
      { ...deployments[0], id: "dep-36", release_id: "tes-testing:550e8400:36", image_digest: digest },
      { ...deployments[0], id: "dep-staging", release_id: "tes-testing:550e8400:37", image_digest: digestB },
    ];
    render(
      <ReleaseEnvironmentBoard
        releases={duaRelease}
        environments={environments}
        deployments={duaDeployment}
        role="qa"
      />,
    );

    // Kartu rilis dirender di luar kartu environment, jadi kueri tanpa pembatas.
    const digantikan = screen.getByTestId("release-digantikan");
    expect(digantikan).toHaveTextContent("Digantikan build 37");
    const kartuLama = digantikan.closest("article")!;
    expect(within(kartuLama).queryByTestId("release-tindakan")).toBeNull();
    expect(within(kartuLama).queryByTestId("release-umur")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Setujui" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Tolak" })).toHaveLength(2);
  });

  it("mengirim rollback dengan environment production", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ job: "tes-testing-rollback" }) });
    vi.stubGlobal("fetch", fetchMock);
    const aktif = [{ ...releases[0], status: "aktif" as const }];
    render(
      <ReleaseEnvironmentBoard
        releases={aktif}
        environments={environments}
        deployments={deployments}
        role="qa"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rollback Production" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opsi] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/releases/rel-1/rollback");
    expect(JSON.parse(String(opsi.body))).toEqual({ environment: "production" });
  });
});
