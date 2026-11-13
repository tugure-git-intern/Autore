import { describe, expect, it } from "vitest";
import { foldReleaseEvents, isReleaseEvent, type ReleaseEvent } from "./release-events";

const COMMIT = "a".repeat(40);
const DIGEST_1 = "sha256:" + "1".repeat(64);
const DIGEST_2 = "sha256:" + "2".repeat(64);

function event(overrides: Partial<ReleaseEvent> = {}): ReleaseEvent {
  return {
    id: "evt-1",
    ts: "2026-11-13T04:00:00Z",
    kind: "requested",
    app: "tes-testing",
    environment: "staging",
    request_id: "req-1",
    commit: COMMIT,
    build_number: 1,
    actor: "operator",
    ...overrides,
  };
}

function sukses(build: number, digest: string, deploymentId: string): ReleaseEvent[] {
  return [
    event({ id: `req-${build}`, kind: "requested", build_number: build, request_id: `req-${build}` }),
    event({ id: `build-${build}`, kind: "build_started", build_number: build, request_id: `req-${build}` }),
    event({
      id: `digest-${build}`,
      kind: "digest_verified",
      build_number: build,
      request_id: `req-${build}`,
      digest,
      image_ref: `127.0.0.1:5000/tes-testing@${digest}`,
    }),
    event({
      id: `deploy-${build}`,
      kind: "deploy_result",
      build_number: build,
      request_id: `req-${build}`,
      digest,
      deployment_id: deploymentId,
      outcome: "success",
      active_before: build === 1 ? null : { deployment_id: `dep-${build - 1}`, digest: DIGEST_1 },
      active_after: { deployment_id: deploymentId, digest },
      health: "ok",
    }),
  ];
}

describe("fold event release", () => {
  it("membuat dua deployment dan pointer staging, tanpa status aktif", () => {
    const hasil = foldReleaseEvents([...sukses(1, DIGEST_1, "dep-1"), ...sukses(2, DIGEST_2, "dep-2")]);

    expect(hasil.releases).toHaveLength(2);
    expect(hasil.releases.every((release) => release.status === "menunggu_persetujuan")).toBe(true);
    expect(hasil.releases.some((release) => release.status === "aktif")).toBe(false);
    expect(hasil.deployments.map((deployment) => deployment.image_digest)).toEqual([DIGEST_1, DIGEST_2]);
    expect(hasil.environments.find((environment) => environment.nama === "staging")?.active_deployment_id)
      .toBe("dep-2");
  });

  it("rollback mempertahankan pointer lama dan menandai release baru rolled_back", () => {
    const hasil = foldReleaseEvents([
      ...sukses(1, DIGEST_1, "dep-1"),
      event({
        id: "deploy-2",
        kind: "deploy_result",
        build_number: 2,
        request_id: "req-2",
        digest: DIGEST_2,
        deployment_id: "dep-2",
        outcome: "rolled_back",
        active_before: { deployment_id: "dep-1", digest: DIGEST_1 },
        active_after: { deployment_id: "dep-1", digest: DIGEST_1 },
        health: "gagal",
        error: "health gagal",
      }),
    ]);

    const staging = hasil.environments.find((environment) => environment.nama === "staging");
    const baru = hasil.releases.find((release) => release.commit_sha === COMMIT && release.id.endsWith(":2"));
    expect(staging?.active_deployment_id).toBe("dep-1");
    expect(baru?.status).toBe("rolled_back");
    expect(baru?.status).not.toBe("aktif");
    expect(hasil.releases.every((release) => release.status !== "aktif")).toBe(true);
  });

  it("kegagalan tanpa deployment lama tidak membuat pointer palsu", () => {
    const hasil = foldReleaseEvents([
      event({
        id: "deploy-1",
        kind: "deploy_result",
        build_number: 1,
        digest: DIGEST_1,
        deployment_id: "dep-1",
        outcome: "failed_no_active",
        active_before: null,
        active_after: null,
        error: "container tidak sehat",
      }),
    ]);

    expect(hasil.environments.find((environment) => environment.nama === "staging")?.active_deployment_id)
      .toBeNull();
    expect(hasil.releases[0]?.status).toBe("gagal");
  });

  it("menolak field asing dan event yang tidak lengkap", () => {
    expect(isReleaseEvent({ ...event(), asing: true })).toBe(false);
    expect(isReleaseEvent({ ...event(), kind: "deploy_result" })).toBe(false);
    expect(() => foldReleaseEvents([{ ...event(), asing: true } as ReleaseEvent])).toThrow(
      "invalid release event",
    );
  });
});


describe("production environment", () => {
  it("tes-testing production environment is configured with target 127.0.0.1:8154", () => {
    const hasil = foldReleaseEvents([...sukses(1, DIGEST_1, "dep-1")]);
    const prod = hasil.environments.find((e) => e.nama === "production");
    expect(prod?.status_konfigurasi).toBe("terkonfigurasi");
    expect(prod?.target).toBe("127.0.0.1:8154");
    expect(prod?.active_deployment_id).toBeNull();
  });

  it("aplikasi lain production environment belum dikonfigurasi", () => {
    const hasil = foldReleaseEvents([
      event({ id: "req-1", kind: "requested", app: "java-tes" }),
    ]);
    const prod = hasil.environments.find((e) => e.nama === "production");
    expect(prod?.status_konfigurasi).toBe("belum_dikonfigurasi");
    expect(prod?.target).toBeNull();
  });

  it("production deploy tanpa approval ditolak (state machine)", () => {
    expect(() => foldReleaseEvents([
      ...sukses(1, DIGEST_1, "dep-stg-1"),
      event({
        id: "dep-prod-1",
        kind: "deploy_result",
        environment: "production",
        digest: DIGEST_1,
        deployment_id: "dep-prod-1",
        outcome: "success",
        active_before: null,
        active_after: { deployment_id: "dep-prod-1", digest: DIGEST_1 },
      }),
    ])).toThrow("transisi ilegal: menunggu_persetujuan -> production_sehat");
  });

  it("production deploy tanpa menunggu_persetujuan ditolak", () => {
    expect(() => foldReleaseEvents([
      event({
        id: "dep-prod-1",
        kind: "deploy_result",
        environment: "production",
        digest: DIGEST_1,
        deployment_id: "dep-prod-1",
        outcome: "success",
        active_before: null,
        active_after: { deployment_id: "dep-prod-1", digest: DIGEST_1 },
      }),
    ])).toThrow("production deploy hanya untuk release menunggu_persetujuan");
  });
});


