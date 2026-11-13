import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReleasePanel } from "./release-panel";

const DIGEST = "sha256:" + "1".repeat(64);

const payload = {
  data: {
    releases: [
      {
        id: "tes-testing:" + "a".repeat(40) + ":1",
        application_id: "tes-testing",
        commit_sha: "a".repeat(40),
        image_digest: DIGEST,
        status: "menunggu_persetujuan",
        approved_by: null,
        alasan: null,
        dibuat_oleh: "operator",
        dibuat_pada: "2026-11-13T04:00:00Z",
      },
    ],
    deployments: [
      {
        id: "dep-1",
        release_id: "tes-testing:" + "a".repeat(40) + ":1",
        environment_id: "tes-testing:staging",
        image_digest: DIGEST,
        status: "sehat",
        health_check_url: "http://127.0.0.1:8153/health",
        mulai_pada: "2026-11-13T04:00:00Z",
        selesai_pada: "2026-11-13T04:01:00Z",
        error: null,
      },
    ],
    environments: [
      {
        id: "tes-testing:staging",
        application_id: "tes-testing",
        nama: "staging",
        target: "vps-staging",
        status_konfigurasi: "terkonfigurasi",
        active_deployment_id: "dep-1",
      },
      {
        id: "tes-testing:production",
        application_id: "tes-testing",
        nama: "production",
        target: null,
        status_konfigurasi: "belum_dikonfigurasi",
        active_deployment_id: null,
      },
    ],
  },
  stale: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("ReleasePanel", () => {
  it("menampilkan staging dan production belum dikonfigurasi tanpa tombol aksi", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    render(<ReleasePanel appId="tes-testing" appName="tes-testing" />);

    await waitFor(() => expect(screen.getByTestId("release-panel")).toBeVisible());
    const production = screen.getByTestId("environment-production");
    expect(within(production).getByText("Belum dikonfigurasi")).toBeVisible();
    expect(screen.getByText("Menunggu Persetujuan")).toBeVisible();
    expect(screen.queryByRole("button", { name: /deploy/i })).toBeNull();
    expect(screen.queryByText("Aktif")).toBeNull();
  });

  it("tidak merender apa pun saat event kosong atau request gagal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { releases: [], deployments: [], environments: [] }, stale: false }), { status: 200 })));
    const kosong = render(<ReleasePanel appId="tes-testing" appName="tes-testing" />);
    await waitFor(() => expect(kosong.container.firstChild).toBeNull());

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    const gagal = render(<ReleasePanel appId="lain" appName="lain" />);
    await waitFor(() => expect(gagal.container.firstChild).toBeNull());
  });
});
