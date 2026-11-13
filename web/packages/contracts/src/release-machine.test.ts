import { describe, expect, it } from "vitest";
import { rollbackRelease, transisiRelease } from "./index";
import { deployment, release } from "./releases.test";
import type { Environment } from "./index";

function environment(
  nama: Environment["nama"],
  application_id = "app-1",
  overrides: Partial<Environment> = {},
): Environment {
  return {
    id: `env-${nama}`,
    application_id,
    nama,
    target: `${nama}.internal`,
    status_konfigurasi: "terkonfigurasi",
    active_deployment_id: null,
    ...overrides,
  };
}

describe("rollback production", () => {
  function skenario() {
    const lama = { ...release("aktif"), id: "rel-lama", approved_by: "approver" };
    const lamaDep = {
      ...deployment("env-production", "sehat", "rel-lama"),
      id: "dep-lama",
    };
    const env = {
      id: "env-production",
      application_id: "app-1",
      nama: "production" as const,
      target: "production.internal",
      status_konfigurasi: "terkonfigurasi" as const,
      active_deployment_id: "dep-lama",
    };
    const gagal = { ...release("gagal"), approved_by: "approver" };
    return { lama, lamaDep, env, gagal };
  }

  it("mempertahankan active_deployment_id release lama dan menandai release baru rolled_back", () => {
    const { lama, lamaDep, env, gagal } = skenario();
    const hasil = rollbackRelease(env, gagal, lamaDep, lama);

    expect(hasil.release.status).toBe("rolled_back");
    expect(hasil.release.status).not.toBe("aktif");
    expect(hasil.environment.active_deployment_id).toBe("dep-lama");
    expect(hasil.environment.active_deployment_id).toBe(lamaDep.id);
    expect(lama.status).toBe("aktif");
  });

  it("menolak rollback menuju deployment yang tidak sehat atau release lain", () => {
    const { lama, lamaDep, env, gagal } = skenario();
    expect(() => rollbackRelease(env, gagal, { ...lamaDep, status: "gagal" }, lama)).toThrow(
      "belum sehat",
    );
    expect(() => rollbackRelease(env, gagal, { ...lamaDep, release_id: "rel-asing" }, lama)).toThrow(
      "tidak cocok",
    );
    expect(() => rollbackRelease(env, release("aktif"), lamaDep, lama)).toThrow(
      "hanya untuk release gagal",
    );
  });

  it("menolak rollback jika salah satu entitas berasal dari aplikasi lain", () => {
    const { lama, lamaDep, env, gagal } = skenario();
    expect(() => rollbackRelease(env, { ...gagal, application_id: "app-2" }, lamaDep, lama)).toThrow(
      "aplikasi berbeda",
    );
    expect(() => rollbackRelease({ ...env, application_id: "app-2" }, gagal, lamaDep, lama)).toThrow(
      "aplikasi berbeda",
    );
    expect(() => rollbackRelease(env, gagal, lamaDep, { ...lama, application_id: "app-2" })).toThrow(
      "aplikasi berbeda",
    );
  });
});

describe("state machine release", () => {
  it("menjalani jalur legal sampai aktif", () => {
    const staging = deployment("env-staging", "sehat");
    const production = deployment("env-production", "sehat");
    let state = release("draft");
    for (const [aksi, status] of [
      ["build_mulai", "build_berjalan"],
      ["build_sukses", "siap_staging"],
      ["staging_mulai", "staging_berjalan"],
      ["staging_sehat", "menunggu_persetujuan"],
      ["approve", "production_berjalan"],
      ["production_sehat", "aktif"],
    ] as const) {
      const env = aksi === "staging_sehat" ? staging : production;
      state = transisiRelease(state, aksi, {
        deployment: env,
        environment: environment(aksi === "staging_sehat" ? "staging" : "production"),
        actor: "approver",
      });
      expect(state.status).toBe(status);
    }
    expect(state.approved_by).toBe("approver");
  });

  it("menolak membuka approval sebelum staging sehat", () => {
    for (const status of ["berjalan", "gagal"] as const) {
      expect(() => transisiRelease(release("staging_berjalan"), "staging_sehat", {
        deployment: deployment("env-staging", status),
        environment: environment("staging"),
      })).toThrow("staging belum sehat");
    }
  });

  it("menolak deployment aplikasi lain untuk membuka approval", () => {
    expect(() => transisiRelease(release("staging_berjalan"), "staging_sehat", {
      deployment: deployment("env-staging", "sehat"),
      environment: environment("staging", "app-2"),
    })).toThrow("aplikasi berbeda");
  });

  it("health check staging gagal menuju gagal, bukan approval", () => {
    expect(transisiRelease(release("staging_berjalan"), "staging_gagal").status).toBe("gagal");
  });

  it("menolak approve tanpa actor dan reject tanpa alasan", () => {
    expect(() => transisiRelease(release("menunggu_persetujuan"), "approve")).toThrow("approver");
    expect(() => transisiRelease(release("menunggu_persetujuan"), "reject", {
      actor: "approver",
    })).toThrow("alasan");
    expect(transisiRelease(release("menunggu_persetujuan"), "reject", {
      actor: "approver",
      alasan: "Regresi pembayaran klaim.",
    }).status).toBe("ditolak");
  });

  it("menolak minimal lima transisi ilegal", () => {
    const ilegal = [
      [release("draft"), "approve"],
      [release("build_berjalan"), "production_sehat"],
      [release("menunggu_persetujuan"), "staging_sehat"],
      [release("ditolak"), "approve"],
      [release("aktif"), "build_mulai"],
      [release("gagal"), "production_sehat"],
      [release("rolled_back"), "approve"],
    ] as const;
    for (const [state, aksi] of ilegal) {
      expect(() => transisiRelease(state, aksi, {
        actor: "approver",
        alasan: "coba",
        deployment: deployment("env-production", "sehat"),
        environment: environment("production"),
      })).toThrow("transisi ilegal");
    }
  });

  it("menolak deployment dari release atau digest lain", () => {
    expect(() => transisiRelease(release("staging_berjalan"), "staging_sehat", {
      deployment: deployment("env-staging", "sehat", "rel-lain"),
      environment: environment("staging"),
    })).toThrow("tidak cocok");
    expect(() => transisiRelease(release("staging_berjalan"), "staging_sehat", {
      deployment: { ...deployment("env-staging", "sehat"), image_digest: "sha256:" + "b".repeat(64) },
      environment: environment("staging"),
    })).toThrow("tidak cocok");
  });

  it("tidak mengaktifkan production memakai deployment staging sehat", () => {
    const approved = { ...release("production_berjalan"), approved_by: "approver" };
    expect(() => transisiRelease(approved, "production_sehat", {
      deployment: deployment("env-staging", "sehat"),
      environment: environment("staging"),
    })).toThrow("environment harus production");
  });

  it("production_sehat memvalidasi deployment, aplikasi, release, digest, dan target", () => {
    const approved = { ...release("production_berjalan"), approved_by: "approver" };
    const valid = {
      deployment: deployment("env-production", "sehat"),
      environment: environment("production"),
    };
    expect(transisiRelease(approved, "production_sehat", valid).status).toBe("aktif");

    const kasus = [
      [{ deployment: deployment("env-production", "gagal"), environment: environment("production") }, "production belum sehat"],
      [{ deployment: deployment("env-production", "sehat", "rel-lain"), environment: environment("production") }, "tidak cocok"],
      [{ deployment: { ...valid.deployment, image_digest: "sha256:" + "b".repeat(64) }, environment: environment("production") }, "tidak cocok"],
      [{ deployment: valid.deployment, environment: environment("production", "app-2") }, "aplikasi berbeda"],
      [{ deployment: valid.deployment, environment: environment("production", "app-1", { target: null, status_konfigurasi: "belum_dikonfigurasi" }) }, "belum dikonfigurasi"],
      [{ deployment: valid.deployment, environment: environment("production", "app-1", { id: "env-lain" }) }, "tidak cocok"],
    ] as const;
    for (const [konteks, pesan] of kasus) {
      expect(() => transisiRelease(approved, "production_sehat", konteks)).toThrow(pesan);
    }
  });
});
