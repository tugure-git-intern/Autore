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

function deployResult(overrides: Partial<ReleaseEvent> = {}): ReleaseEvent {
  const digest = overrides.digest ?? DIGEST_1;
  const deploymentId = overrides.deployment_id ?? "dep-x";
  return event({
    id: "deploy-x",
    kind: "deploy_result",
    digest,
    deployment_id: deploymentId,
    outcome: "success",
    active_before: null,
    health: "ok",
    ...overrides,
    active_after: overrides.active_after ?? { deployment_id: deploymentId, digest },
  });
}

/** Rantai event sampai staging sehat: release berakhir di menunggu_persetujuan. */
function sampaiStagingSehat(digest = DIGEST_1, dibuatOleh = "operator"): ReleaseEvent[] {
  return [
    event({ id: "req-1", kind: "requested", actor: dibuatOleh }),
    event({ id: "build-1", kind: "build_started", actor: dibuatOleh }),
    event({
      id: "digest-1",
      kind: "digest_verified",
      digest,
      image_ref: `127.0.0.1:5000/tes-testing@${digest}`,
      actor: dibuatOleh,
    }),
    deployResult({ id: "deploy-stg-1", digest, deployment_id: "dep-stg-1" }),
  ];
}

/** Rantai event sampai staging_berjalan: staging belum naik, approval belum sah. */
function sampaiStagingBerjalan(): ReleaseEvent[] {
  return [
    event({ id: "req-1", kind: "requested" }),
    event({ id: "build-1", kind: "build_started" }),
    event({ id: "digest-1", kind: "digest_verified", digest: DIGEST_1 }),
  ];
}

function approveEvent(overrides: Partial<ReleaseEvent> = {}): ReleaseEvent {
  return event({ id: "approve-1", kind: "approved", actor: "budi", ...overrides });
}

function productionDeploy(overrides: Partial<ReleaseEvent> = {}): ReleaseEvent {
  return deployResult({
    id: "deploy-prod-1",
    environment: "production",
    deployment_id: "dep-prod-1",
    ...overrides,
  });
}

describe("siklus approval release", () => {
  it("approve dari menunggu_persetujuan menuju disetujui dan mencatat approved_by", () => {
    const hasil = foldReleaseEvents([...sampaiStagingSehat(), approveEvent({ actor: "budi" })]);
    const rel = hasil.releases[0];
    expect(rel.status).toBe("disetujui");
    expect(rel.approved_by).toBe("budi");
  });

  it("approve dari status salah (staging_berjalan) ditolak", () => {
    expect(() => foldReleaseEvents([...sampaiStagingBerjalan(), approveEvent({ actor: "budi" })])).toThrow(
      "approve hanya untuk release menunggu_persetujuan",
    );
  });

  it("approve kedua idempoten: tetap disetujui tanpa perubahan lain", () => {
    const sekali = foldReleaseEvents([...sampaiStagingSehat(), approveEvent({ actor: "budi" })]);
    const hasil = foldReleaseEvents([
      ...sampaiStagingSehat(),
      approveEvent({ actor: "budi" }),
      approveEvent({ id: "approve-2", actor: "siti" }),
    ]);
    expect(hasil.releases[0].status).toBe("disetujui");
    expect(hasil.releases[0].approved_by).toBe("budi");
    expect(hasil.releases[0]).toEqual(sekali.releases[0]);
  });

  it("self-approval ditolak walau beda huruf besar/kecil dan spasi", () => {
    expect(() => foldReleaseEvents([
      ...sampaiStagingSehat(DIGEST_1, "operator"),
      approveEvent({ actor: "operator" }),
    ])).toThrow("approve tidak boleh oleh pembuat release");
    expect(() => foldReleaseEvents([
      ...sampaiStagingSehat(DIGEST_1, "Operator"),
      approveEvent({ actor: "  operator  " }),
    ])).toThrow("approve tidak boleh oleh pembuat release");
  });

  it("self-approval diterima bila self_approval true", () => {
    const hasil = foldReleaseEvents([
      ...sampaiStagingSehat(DIGEST_1, "operator"),
      approveEvent({ actor: "operator", self_approval: true }),
    ]);
    expect(hasil.releases[0].status).toBe("disetujui");
    expect(hasil.releases[0].approved_by).toBe("operator");
  });

  it("approve pada release ditolak ditolak (tidak ada jalan ditolak -> disetujui)", () => {
    const rejected = event({ id: "reject-1", kind: "rejected", actor: "budi", error: "Regresi klaim." });
    expect(() => foldReleaseEvents([
      ...sampaiStagingSehat(),
      rejected,
      approveEvent({ actor: "budi" }),
    ])).toThrow("approve hanya untuk release menunggu_persetujuan");
  });

  it("reject dari menunggu_persetujuan menuju ditolak dan memakai error sebagai alasan", () => {
    const hasil = foldReleaseEvents([
      ...sampaiStagingSehat(),
      event({ id: "reject-1", kind: "rejected", actor: "budi", error: "Regresi pembayaran klaim." }),
    ]);
    expect(hasil.releases[0].status).toBe("ditolak");
    expect(hasil.releases[0].alasan).toBe("Regresi pembayaran klaim.");
  });

  it("reject dari status lain ditolak", () => {
    expect(() => foldReleaseEvents([
      ...sampaiStagingBerjalan(),
      event({ id: "reject-1", kind: "rejected", actor: "budi", error: "coba" }),
    ])).toThrow("reject hanya untuk release menunggu_persetujuan");
  });

  it("deploy_result staging pada release ditolak ditolak", () => {
    const rejected = event({ id: "reject-1", kind: "rejected", actor: "budi", error: "Regresi klaim." });
    expect(() => foldReleaseEvents([
      ...sampaiStagingSehat(),
      rejected,
      deployResult({ id: "deploy-stg-2", deployment_id: "dep-stg-2" }),
    ])).toThrow("transisi ilegal");
  });
});

describe("promosi production", () => {
  it("deploy production pada release menunggu_persetujuan ditolak (K1)", () => {
    expect(() => foldReleaseEvents([
      ...sampaiStagingSehat(),
      productionDeploy(),
    ])).toThrow("production deploy hanya untuk release disetujui");
  });

  it("deploy production pada release disetujui dengan digest sama menjadi aktif", () => {
    const hasil = foldReleaseEvents([
      ...sampaiStagingSehat(DIGEST_1),
      approveEvent({ actor: "budi" }),
      productionDeploy({ digest: DIGEST_1 }),
    ]);
    expect(hasil.releases[0].status).toBe("aktif");
    expect(hasil.environments.find((e) => e.nama === "production")?.active_deployment_id).toBe("dep-prod-1");
  });

  it("deploy production dengan digest berbeda dari deployment staging aktif ditolak", () => {
    expect(() => foldReleaseEvents([
      ...sampaiStagingSehat(DIGEST_1),
      approveEvent({ actor: "budi" }),
      productionDeploy({ digest: DIGEST_2 }),
    ])).toThrow("digest production harus sama dengan deployment staging aktif");
  });
});

describe("kegagalan deploy staging (K4)", () => {
  it("smoke gagal dengan deployment sehat sebelumnya: rolled_back dan pointer kembali", () => {
    const hasil = foldReleaseEvents([
      ...sampaiStagingSehat(DIGEST_1),
      deployResult({
        id: "deploy-stg-2",
        build_number: 2,
        request_id: "req-2",
        digest: DIGEST_2,
        deployment_id: "dep-stg-2",
        outcome: "rolled_back",
        active_before: { deployment_id: "dep-stg-1", digest: DIGEST_1 },
        active_after: { deployment_id: "dep-stg-1", digest: DIGEST_1 },
        error: "health gagal",
      }),
    ]);
    const staging = hasil.environments.find((e) => e.nama === "staging");
    const baru = hasil.releases.find((r) => r.id.endsWith(":2"));
    expect(baru?.status).toBe("rolled_back");
    expect(staging?.active_deployment_id).toBe("dep-stg-1");
  });

  it("smoke gagal tanpa deployment sebelumnya: gagal dan pointer staging null", () => {
    const hasil = foldReleaseEvents([
      deployResult({
        id: "deploy-stg-1",
        digest: DIGEST_1,
        deployment_id: "dep-stg-1",
        outcome: "failed_no_active",
        active_before: null,
        active_after: null,
        error: "container tidak sehat",
      }),
    ]);
    const staging = hasil.environments.find((e) => e.nama === "staging");
    expect(hasil.releases[0].status).toBe("gagal");
    expect(staging?.active_deployment_id).toBeNull();
  });
});

describe("validator event approval", () => {
  const dasar = (overrides: Record<string, unknown> = {}) => ({
    id: "evt-1",
    ts: "2026-11-13T04:00:00Z",
    kind: "approved",
    app: "tes-testing",
    environment: "staging",
    request_id: "req-1",
    commit: COMMIT,
    build_number: 1,
    actor: "budi",
    ...overrides,
  });

  it("menolak approved tanpa actor", () => {
    const { actor: _actorDrop, ...tanpaActor } = dasar();
    expect(isReleaseEvent(tanpaActor)).toBe(false);
  });

  it("menolak rejected tanpa error", () => {
    expect(isReleaseEvent(dasar({ kind: "rejected" }))).toBe(false);
    expect(isReleaseEvent(dasar({ kind: "rejected", error: "Regresi klaim." }))).toBe(true);
  });

  it("menerima approved dengan self_approval true dan menolak self_approval bukan boolean", () => {
    expect(isReleaseEvent(dasar({ self_approval: true }))).toBe(true);
    expect(isReleaseEvent(dasar({ self_approval: "ya" }))).toBe(false);
  });
});
