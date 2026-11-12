import { hasKeys, isAbsentOr, isCount, isString } from "./guards";

export const statusValues = new Set<string>([
  "idle",
  "running",
  "passed",
  "failed",
  "unknown",
  "pending",
  "skipped",
]);

export const infraStatusValues = new Set<string>(["active", "inactive", "unknown"]);

export type StatusValue =
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "unknown"
  | "pending"
  | "skipped";

export type InfraStatus = "active" | "inactive" | "unknown";

export type RepositoryHealth = {
  score_percent: number;
  total_repos: number;
  gold: number;
  silver: number;
  bronze: number;
};

export type StageTime = { id: string; at: string };

/** Satu entri peta `penulis`: `[sha commit, "Nama <email>"]`. */
export type PenulisEntry = [string, string];

export type ApplicationRecord = {
  id: string;
  name: string;
  status: StatusValue;
  last_build: string;
  commit_sha: string;
  security_issues: number;
  /** Snapshot lama dari CLI sebelum Phase 6 tidak membawa field ini. */
  deployed?: boolean;
  /** Pembuat aplikasi (audit trail): "Nama <email>". Snapshot lama tidak punya. */
  author?: string;
};

/** Mirrors `autore status --json`. Text that is unavailable is "" — never null. */
export interface DashboardStatus {
  system_status: StatusValue;
  infra: { jenkins: InfraStatus; nexus: InfraStatus };
  stats: { total_apps: number; running_containers: number };
  repository_health: RepositoryHealth;
  applications: ApplicationRecord[];
  latest_pipeline: {
    status: StatusValue;
    failure_reason: string;
    /** Started stage ids in execution order. No per-stage pass/fail exists in the contract. */
    stages: string[];
    /** Waktu mulai tiap tahap. Belum ada pada snapshot yang ditulis CLI lama. */
    stage_times?: StageTime[];
    finished_at?: string;
    started_at?: string;
    gates_passed?: number;
    gates_total?: number;
    security_summary: string;
    commit_sha: string;
    author: string;
    raw_log: string[];
  };
  /** Peta `sha commit -> penulis` dari rekaman pipeline. Snapshot lama tidak punya. */
  penulis?: PenulisEntry[];
}

const PIPELINE_OPSIONAL = [
  "stage_times",
  "finished_at",
  "started_at",
  "gates_passed",
  "gates_total",
];

export function isDashboardStatus(value: unknown): value is DashboardStatus {
  if (
    !hasKeys(
      value,
      [
        "system_status",
        "infra",
        "stats",
        "repository_health",
        "applications",
        "latest_pipeline",
      ],
      ["penulis"],
    )
  ) {
    return false;
  }

  return (
    isStatus(value.system_status) &&
    isInfra(value.infra) &&
    isStats(value.stats) &&
    isRepositoryHealth(value.repository_health) &&
    Array.isArray(value.applications) &&
    value.applications.every(isApplication) &&
    isPenulis(value.penulis) &&
    isPipeline(value.latest_pipeline)
  );
}

/** Fail-closed: bentuk yang tidak dikenal ditolak dengan galat, bukan diteruskan. */
export function validateDashboardStatus(raw: unknown): DashboardStatus {
  if (!isDashboardStatus(raw)) throw new Error("invalid Autore status payload");
  return raw;
}

export function parseDashboardStatus(stdout: string): DashboardStatus {
  return validateDashboardStatus(JSON.parse(stdout) as unknown);
}

export function isRepositoryHealth(value: unknown): value is RepositoryHealth {
  return (
    hasKeys(value, ["score_percent", "total_repos", "gold", "silver", "bronze"]) &&
    isCount(value.score_percent) &&
    isCount(value.total_repos) &&
    isCount(value.gold) &&
    isCount(value.silver) &&
    isCount(value.bronze)
  );
}

export function isInfra(value: unknown): value is DashboardStatus["infra"] {
  return (
    hasKeys(value, ["jenkins", "nexus"]) &&
    isInfraStatus(value.jenkins) &&
    isInfraStatus(value.nexus)
  );
}

export function isStats(value: unknown): value is DashboardStatus["stats"] {
  return (
    hasKeys(value, ["total_apps", "running_containers"]) &&
    isCount(value.total_apps) &&
    isCount(value.running_containers)
  );
}

export function isApplication(value: unknown): value is ApplicationRecord {
  return (
    hasKeys(
      value,
      ["id", "name", "status", "last_build", "commit_sha", "security_issues"],
      ["deployed", "author"],
    ) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isStatus(value.status) &&
    isString(value.last_build) &&
    isString(value.commit_sha) &&
    isCount(value.security_issues) &&
    isAbsentOr<boolean>(value.deployed, (v): v is boolean => typeof v === "boolean") &&
    isAbsentOr<string>(value.author, isString)
  );
}

export function isPipeline(value: unknown): value is DashboardStatus["latest_pipeline"] {
  return (
    hasKeys(
      value,
      [
        "status",
        "failure_reason",
        "stages",
        "security_summary",
        "commit_sha",
        "author",
        "raw_log",
      ],
      PIPELINE_OPSIONAL,
    ) &&
    isStatus(value.status) &&
    isString(value.failure_reason) &&
    isStages(value.stages) &&
    isStageTimes(value.stage_times) &&
    isAbsentOr<string>(value.finished_at, isString) &&
    isAbsentOr<string>(value.started_at, isString) &&
    isAbsentOr<number>(value.gates_passed, isCount) &&
    isAbsentOr<number>(value.gates_total, isCount) &&
    isString(value.security_summary) &&
    isString(value.commit_sha) &&
    isString(value.author) &&
    Array.isArray(value.raw_log) &&
    value.raw_log.every((line) => typeof line === "string")
  );
}

export function isPenulis(value: unknown): value is PenulisEntry[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (entri) => Array.isArray(entri) && entri.length === 2 && entri.every(isString),
      ))
  );
}

export function isStageTimes(value: unknown): value is StageTime[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (waktu) => hasKeys(waktu, ["id", "at"]) && isString(waktu.id) && isString(waktu.at),
      ))
  );
}

export function isStages(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((stage) => typeof stage === "string");
}

export function isStatus(value: unknown): value is StatusValue {
  return typeof value === "string" && statusValues.has(value);
}

export function isInfraStatus(value: unknown): value is InfraStatus {
  return typeof value === "string" && infraStatusValues.has(value);
}