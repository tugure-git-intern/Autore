import { describe, expect, it } from "vitest";
import {
  type RegisteredApplication,
  type Deployment,
  type Environment,
  type Release,
  isRegisteredApplication,
  isApproval,
  isDeployment,
  isEnvironment,
  isRelease,
} from "./index";

const waktu = "2026-11-12T06:00:00.000Z";

export function application(): RegisteredApplication {
  return {
    id: "app-1",
    nama: "Portal Klaim",
    repo_url: "https://github.com/kantor/portal-klaim",
    default_branch: "main",
  };
}

export function release(status: Release["status"] = "staging_berjalan"): Release {
  return {
    id: "rel-1",
    application_id: "app-1",
    commit_sha: "0123456789abcdef0123456789abcdef01234567",
    image_digest: "sha256:" + "a".repeat(64),
    status,
    approved_by: null,
    alasan: null,
    dibuat_oleh: "developer",
    dibuat_pada: waktu,
  };
}

export function deployment(
  environment_id: string,
  status: Deployment["status"] = "berjalan",
  release_id = "rel-1",
): Deployment {
  return {
    id: `dep-${environment_id}`,
    release_id,
    environment_id,
    image_digest: release().image_digest ?? "sha256:" + "a".repeat(64),
    status,
    health_check_url: "http://staging.internal/health",
    mulai_pada: waktu,
    selesai_pada: null,
    error: null,
  };
}

function environment(): Environment {
  return {
    id: "env-production",
    application_id: "app-1",
    nama: "production",
    target: null,
    status_konfigurasi: "belum_dikonfigurasi",
    active_deployment_id: null,
  };
}

describe("model data environment dan release", () => {
  it("menerima lima entitas yang sah", () => {
    expect(isRegisteredApplication(application())).toBe(true);
    expect(isRelease(release())).toBe(true);
    expect(isEnvironment(environment())).toBe(true);
    expect(isDeployment(deployment("env-staging"))).toBe(true);
    expect(isApproval({
      id: "apr-1",
      release_id: "rel-1",
      keputusan: "reject",
      alasan: "Hasil uji staging belum memenuhi kriteria.",
      actor: "approver",
      pada: waktu,
    })).toBe(true);
  });

  it("menolak kunci asing pada setiap entitas", () => {
    for (const [sah, nilai] of [
      [isRegisteredApplication, application()],
      [isRelease, release()],
      [isEnvironment, environment()],
      [isDeployment, deployment("env-staging")],
    ] as const) {
      expect(sah({ ...nilai, credential: "tidak-boleh" })).toBe(false);
    }
  });

  it("menolak production tanpa target yang mengaku terkonfigurasi", () => {
    expect(isEnvironment({ ...environment(), status_konfigurasi: "terkonfigurasi" })).toBe(false);
  });

  it("menolak release ditolak tanpa alasan", () => {
    expect(isRelease(release("ditolak"))).toBe(false);
    expect(isRelease({ ...release("ditolak"), alasan: "   " })).toBe(false);
    expect(isRelease({ ...release("ditolak"), alasan: "Regresi klaim." })).toBe(true);
  });

  it("menolak approval reject tanpa alasan dan tidak menerima bentuk lain", () => {
    const dasar = {
      id: "apr-1",
      release_id: "rel-1",
      keputusan: "reject",
      alasan: "Perlu perbaikan.",
      actor: "approver",
      pada: waktu,
    };
    expect(isApproval({ ...dasar, alasan: null })).toBe(false);
    expect(isApproval({ ...dasar, keputusan: "mungkin" })).toBe(false);
  });
});
