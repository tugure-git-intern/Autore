import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Deployment, Environment, Release } from "@autore/contracts";
import { BahasaProvider } from "./bahasa-provider";
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
    commit_subject: null,
    branch: null,
    repo_url: null,
    menunggu_sejak: "2026-11-12T03:00:00.000Z",
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

function renderBahasa(awal: "id" | "en", role: "dev" | "qa" | "admin" = "qa") {
  return render(
    <BahasaProvider awal={awal}>
      <ReleaseEnvironmentBoard
        releases={releases}
        environments={environments}
        deployments={deployments}
        role={role}
      />
    </BahasaProvider>,
  );
}

describe("ReleaseEnvironmentBoard bahasa", () => {
  it("merender teks Indonesia secara bawaan", () => {
    renderBahasa("id");

    expect(screen.getByRole("region", { name: "Environment Portal Klaim" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Release Terbaru" })).toBeVisible();
    expect(screen.getByTestId("release-tindakan")).toHaveTextContent(
      "Perlu QA/Admin menyetujui",
    );
    expect(screen.getByTestId("release-dibuat-oleh")).toHaveTextContent("Dibuat oleh developer");
    expect(screen.getByTestId("release-approved-by")).toHaveTextContent("belum disetujui");
    expect(screen.getByRole("button", { name: "Setujui" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Tolak" })).toBeVisible();
    expect(screen.getByText("Belum dikonfigurasi")).toBeVisible();
    expect(screen.getByText("Target production belum diisi oleh admin.")).toBeVisible();
  });

  it("berganti seluruh teks ke bahasa Inggris", () => {
    renderBahasa("en");

    expect(screen.getByRole("region", { name: "Environment Portal Klaim" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Latest Releases" })).toBeVisible();
    expect(screen.getByTestId("release-tindakan")).toHaveTextContent(
      "Needs QA/Admin approval",
    );
    expect(screen.getByTestId("release-umur")).toHaveTextContent("waiting");
    expect(screen.getByTestId("release-dibuat-oleh")).toHaveTextContent("Created by developer");
    expect(screen.getByTestId("release-approved-by")).toHaveTextContent("not approved yet");
    expect(screen.getByTestId("release-subjek")).toHaveTextContent("No commit message");
    expect(screen.getByRole("button", { name: "Approve" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reject" })).toBeVisible();
    expect(screen.getByText("Not configured")).toBeVisible();
    expect(
      screen.getByText("The production target has not been filled in by an admin."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Setujui" })).toBeNull();
  });

  it("label status ikut diterjemahkan", () => {
    renderBahasa("en");
    expect(screen.getByText("Awaiting Approval")).toBeVisible();
  });

  it("panel environment tetap satu region dengan dua kartu", () => {
    renderBahasa("en");
    const staging = screen.getByTestId("environment-staging");
    expect(within(staging).getByRole("heading", { name: "Staging" })).toBeVisible();
    expect(within(staging).getByText("Healthy")).toBeVisible();
  });
});
