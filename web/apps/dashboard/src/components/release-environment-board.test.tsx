import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Deployment, Environment, Release } from "@autore/contracts";
import { ReleaseEnvironmentBoard } from "./release-environment-board";

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
  it("menampilkan staging dan production pada satu dashboard", () => {
    render(<ReleaseEnvironmentBoard releases={releases} environments={environments} deployments={deployments} />);

    const board = screen.getByRole("region", { name: "Environment Portal Klaim" });
    expect(within(board).getByRole("heading", { name: "Staging" })).toBeVisible();
    expect(within(board).getByRole("heading", { name: "Production" })).toBeVisible();
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
    expect(screen.getByText(digest)).toBeVisible();
  });

  it("menolak pasangan deployment dan release dengan digest berbeda", () => {
    const salah = [{ ...deployments[0], image_digest: "sha256:" + "b".repeat(64) }];
    expect(() => render(
      <ReleaseEnvironmentBoard releases={releases} environments={environments} deployments={salah} />,
    )).toThrow("digest deployment tidak sama dengan release");
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
    expect(screen.getByRole("button", { name: "Tolak" })).toBeVisible();
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
});
