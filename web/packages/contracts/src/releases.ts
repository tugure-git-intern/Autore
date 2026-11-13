import { hasKeys, isString } from "./guards";

export const STATUS_RELEASE = [
  "draft",
  "build_berjalan",
  "siap_staging",
  "staging_berjalan",
  "menunggu_persetujuan",
  "production_berjalan",
  "aktif",
  "gagal",
  "ditolak",
  "rolled_back",
] as const;
export type StatusRelease = (typeof STATUS_RELEASE)[number];

export type RegisteredApplication = {
  id: string;
  nama: string;
  repo_url: string;
  default_branch: string;
};

export type Release = {
  id: string;
  application_id: string;
  commit_sha: string;
  image_digest: string | null;
  status: StatusRelease;
  approved_by: string | null;
  alasan: string | null;
  dibuat_oleh: string;
  dibuat_pada: string;
};

export type Environment = {
  id: string;
  application_id: string;
  nama: "staging" | "production";
  target: string | null;
  status_konfigurasi: "terkonfigurasi" | "belum_dikonfigurasi";
  active_deployment_id: string | null;
};

export type Deployment = {
  id: string;
  release_id: string;
  environment_id: string;
  image_digest: string;
  status: "antri" | "berjalan" | "sehat" | "gagal";
  health_check_url: string;
  mulai_pada: string;
  selesai_pada: string | null;
  error: string | null;
};

export type Approval = {
  id: string;
  release_id: string;
  keputusan: "approve" | "reject";
  alasan: string | null;
  actor: string;
  pada: string;
};

export type AksiRelease =
  | "build_mulai"
  | "build_sukses"
  | "build_gagal"
  | "staging_mulai"
  | "staging_sehat"
  | "staging_gagal"
  | "approve"
  | "reject"
  | "production_sehat"
  | "production_gagal"
  | "rollback_selesai";

export type KonteksTransisi = {
  actor?: string;
  alasan?: string;
  deployment?: Deployment;
  environment?: Environment;
};

const TUJUAN: Record<AksiRelease, { dari: StatusRelease; ke: StatusRelease }> = {
  build_mulai: { dari: "draft", ke: "build_berjalan" },
  build_sukses: { dari: "build_berjalan", ke: "siap_staging" },
  build_gagal: { dari: "build_berjalan", ke: "gagal" },
  staging_mulai: { dari: "siap_staging", ke: "staging_berjalan" },
  staging_sehat: { dari: "staging_berjalan", ke: "menunggu_persetujuan" },
  staging_gagal: { dari: "staging_berjalan", ke: "gagal" },
  approve: { dari: "menunggu_persetujuan", ke: "production_berjalan" },
  reject: { dari: "menunggu_persetujuan", ke: "ditolak" },
  production_sehat: { dari: "production_berjalan", ke: "aktif" },
  production_gagal: { dari: "production_berjalan", ke: "gagal" },
  rollback_selesai: { dari: "gagal", ke: "rolled_back" },
};

function validasiDeploymentSehat(
  release: Release,
  nama: Environment["nama"],
  konteks: KonteksTransisi,
): void {
  const dep = konteks.deployment;
  const env = konteks.environment;
  if (!dep || dep.status !== "sehat") throw new Error(`${nama} belum sehat`);
  if (!env || env.nama !== nama) throw new Error(`environment harus ${nama}`);
  if (env.application_id !== release.application_id) throw new Error("environment aplikasi berbeda");
  if (dep.release_id !== release.id || dep.image_digest !== release.image_digest ||
    dep.environment_id !== env.id) {
    throw new Error("deployment tidak cocok dengan release atau environment");
  }
  if (env.status_konfigurasi !== "terkonfigurasi" || !env.target?.trim()) {
    throw new Error("environment belum dikonfigurasi");
  }
}

/**
 * Satu-satunya pintu perubahan status release. Approval dan production aktif
 * dibuka hanya oleh deployment sehat pada environment yang sesuai, untuk
 * release, digest, dan aplikasi yang sama.
 */
export function transisiRelease(
  release: Release,
  aksi: AksiRelease,
  konteks: KonteksTransisi = {},
): Release {
  const aturan = TUJUAN[aksi];
  if (!aturan || release.status !== aturan.dari) {
    throw new Error(`transisi ilegal: ${release.status} -> ${aksi}`);
  }
  if (aksi === "staging_sehat") validasiDeploymentSehat(release, "staging", konteks);
  if (aksi === "production_sehat") validasiDeploymentSehat(release, "production", konteks);
  if (aksi === "approve" && !konteks.actor?.trim()) throw new Error("approver wajib ada");
  if (aksi === "reject" && !konteks.alasan?.trim()) throw new Error("alasan wajib ada");
  return {
    ...release,
    status: aturan.ke,
    approved_by: aksi === "approve" ? konteks.actor!.trim() : release.approved_by,
    alasan: aksi === "reject" ? konteks.alasan!.trim() : release.alasan,
  };
}

export type RollbackResult = {
  environment: Environment;
  release: Release;
};

/**
 * Rollback mempertahankan pointer environment ke deployment sehat release
 * lama. Pointer tidak dipindahkan ke deployment release gagal; release gagal
 * berakhir `rolled_back`, tidak pernah menjadi aktif.
 */
export function rollbackRelease(
  environment: Environment,
  gagal: Release,
  aktifSebelumnya: Deployment,
  releaseLama: Release,
): RollbackResult {
  if (gagal.status !== "gagal") throw new Error("rollback hanya untuk release gagal");
  if (gagal.application_id !== environment.application_id ||
    releaseLama.application_id !== environment.application_id) {
    throw new Error("rollback aplikasi berbeda");
  }
  if (aktifSebelumnya.status !== "sehat") throw new Error("deployment rollback belum sehat");
  if (aktifSebelumnya.id !== environment.active_deployment_id ||
    aktifSebelumnya.release_id !== releaseLama.id ||
    aktifSebelumnya.environment_id !== environment.id) {
    throw new Error("deployment rollback tidak cocok dengan environment");
  }
  if (releaseLama.status !== "aktif") throw new Error("release lama tidak aktif");
  return {
    environment: { ...environment },
    release: { ...gagal, status: "rolled_back" },
  };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

export function isRegisteredApplication(value: unknown): value is RegisteredApplication {
  return hasKeys(value, ["id", "nama", "repo_url", "default_branch"]) &&
    isNonEmpty(value.id) && isNonEmpty(value.nama) &&
    isNonEmpty(value.repo_url) && isNonEmpty(value.default_branch);
}

export function isRelease(value: unknown): value is Release {
  if (!hasKeys(value, [
    "id", "application_id", "commit_sha", "image_digest", "status",
    "approved_by", "alasan", "dibuat_oleh", "dibuat_pada",
  ])) return false;
  if (!isNonEmpty(value.id) || !isNonEmpty(value.application_id) ||
    !/^[0-9a-f]{40}$/.test(String(value.commit_sha)) ||
    (value.image_digest !== null && !/^sha256:[0-9a-f]{64}$/.test(String(value.image_digest))) ||
    !STATUS_RELEASE.includes(value.status as StatusRelease) ||
    !isNullableString(value.approved_by) || !isNullableString(value.alasan) ||
    !isNonEmpty(value.dibuat_oleh) || !isNonEmpty(value.dibuat_pada)) return false;
  if (value.status === "draft" || value.status === "build_berjalan") return true;
  if (value.image_digest === null) return false;
  if (value.status === "ditolak") return isNonEmpty(value.alasan);
  if (value.status === "production_berjalan" || value.status === "aktif") {
    return isNonEmpty(value.approved_by);
  }
  return true;
}

export function isEnvironment(value: unknown): value is Environment {
  if (!hasKeys(value, [
    "id", "application_id", "nama", "target", "status_konfigurasi", "active_deployment_id",
  ])) return false;
  if (!isNonEmpty(value.id) || !isNonEmpty(value.application_id) ||
    (value.nama !== "staging" && value.nama !== "production") ||
    !isNullableString(value.target) || !isNullableString(value.active_deployment_id)) return false;
  if (value.status_konfigurasi === "belum_dikonfigurasi") return value.target === null;
  return value.status_konfigurasi === "terkonfigurasi" && isNonEmpty(value.target);
}

export function isDeployment(value: unknown): value is Deployment {
  return hasKeys(value, [
    "id", "release_id", "environment_id", "image_digest", "status",
    "health_check_url", "mulai_pada", "selesai_pada", "error",
  ]) && isNonEmpty(value.id) && isNonEmpty(value.release_id) &&
    isNonEmpty(value.environment_id) &&
    /^sha256:[0-9a-f]{64}$/.test(String(value.image_digest)) &&
    ["antri", "berjalan", "sehat", "gagal"].includes(String(value.status)) &&
    isNonEmpty(value.health_check_url) && isNonEmpty(value.mulai_pada) &&
    isNullableString(value.selesai_pada) && isNullableString(value.error);
}

export function isApproval(value: unknown): value is Approval {
  if (!hasKeys(value, ["id", "release_id", "keputusan", "alasan", "actor", "pada"])) return false;
  if (!isNonEmpty(value.id) || !isNonEmpty(value.release_id) ||
    (value.keputusan !== "approve" && value.keputusan !== "reject") ||
    !isNullableString(value.alasan) || !isNonEmpty(value.actor) || !isNonEmpty(value.pada)) return false;
  return value.keputusan !== "reject" || isNonEmpty(value.alasan);
}
