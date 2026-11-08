import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const statusValues = new Set([
  "idle",
  "running",
  "passed",
  "failed",
  "unknown",
  "pending",
  "skipped",
]);
const infraStatusValues = new Set(["active", "inactive", "unknown"]);

export type RunAutore = () => Promise<string>;
export type StatusValue =
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "unknown"
  | "pending"
  | "skipped";

export type RepositoryHealth = {
  score_percent: number;
  total_repos: number;
  gold: number;
  silver: number;
  bronze: number;
};

/** Mirrors `autore status --json`. Text that is unavailable is "" — never null. */
export interface DashboardStatus {
  system_status: StatusValue;
  infra: { jenkins: "active" | "inactive" | "unknown"; nexus: "active" | "inactive" | "unknown" };
  stats: { total_apps: number; running_containers: number };
  repository_health: RepositoryHealth;
  applications: Array<{
    id: string;
    name: string;
    status: StatusValue;
    last_build: string;
    commit_sha: string;
    security_issues: number;
    /** Snapshot lama dari CLI sebelum Phase 6 tidak membawa field ini. */
    deployed?: boolean;
    /** Pembuat aplikasi (audit trail) dari config git lokal; snapshot lama kosong. */
    author?: string;
  }>;
  latest_pipeline: {
    status: StatusValue;
    failure_reason: string;
    /** Started stage ids in execution order; the CLI never sends objects here. */
    stages: string[];
    /** When each stage started. Absent in snapshots written before the CLI learned it. */
    stage_times?: Array<{ id: string; at: string }>;
    finished_at?: string;
    gates_passed?: number;
    gates_total?: number;
    security_summary: string;
    commit_sha: string;
    author: string;
    raw_log: string[];
  };
}

let lastRunner: RunAutore | undefined;
let lastGood: DashboardStatus | undefined;
let lastGoodAt = 0;

export const CACHE_STATUS_MS = 5_000;

export function resetStatusCache(): void {
  lastRunner = undefined;
  lastGood = undefined;
  lastGoodAt = 0;
}

export async function runAutore(): Promise<string> {
  const { stdout } = await execFileAsync(
    process.env.AUTORE_BIN || "autore",
    ["status", "--json"],
    {
      encoding: "utf8",
      env: process.env,
      shell: false,
      timeout: 5_000,
    },
  );
  return stdout;
}

export async function loadDashboardStatus(
  run: RunAutore = runAutore,
  clock: () => number = () => Date.now(),
): Promise<{ data: DashboardStatus; stale: boolean }> {
  const sekarang = clock();
  if (run === lastRunner && lastGood && sekarang - lastGoodAt < CACHE_STATUS_MS) {
    return { data: lastGood, stale: false };
  }

  try {
    const data = parseDashboardStatus(await run());
    lastRunner = run;
    lastGood = data;
    lastGoodAt = sekarang;
    return { data, stale: false };
  } catch (error) {
    if (lastGood) return { data: lastGood, stale: true };
    throw error;
  }
}

function parseDashboardStatus(stdout: string): DashboardStatus {
  try {
    const data: unknown = JSON.parse(stdout);
    if (!isDashboardStatus(data)) throw new Error();
    return data;
  } catch {
    throw new Error("invalid Autore status JSON");
  }
}

function isDashboardStatus(value: unknown): value is DashboardStatus {
  if (
    !hasKeys(value, [
      "system_status",
      "infra",
      "stats",
      "repository_health",
      "applications",
      "latest_pipeline",
    ])
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
    isPipeline(value.latest_pipeline)
  );
}

function isRepositoryHealth(value: unknown): value is RepositoryHealth {
  return (
    hasKeys(value, ["score_percent", "total_repos", "gold", "silver", "bronze"]) &&
    isCount(value.score_percent) &&
    isCount(value.total_repos) &&
    isCount(value.gold) &&
    isCount(value.silver) &&
    isCount(value.bronze)
  );
}

function isInfra(value: unknown): value is DashboardStatus["infra"] {
  return (
    hasKeys(value, ["jenkins", "nexus"]) &&
    isInfraStatus(value.jenkins) &&
    isInfraStatus(value.nexus)
  );
}

function isStats(value: unknown): value is DashboardStatus["stats"] {
  return (
    hasKeys(value, ["total_apps", "running_containers"]) &&
    isCount(value.total_apps) &&
    isCount(value.running_containers)
  );
}

function isApplication(value: unknown): value is DashboardStatus["applications"][number] {
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

const PIPELINE_OPSIONAL = [
  "stage_times",
  "finished_at",
  "started_at",
  "gates_passed",
  "gates_total",
];

function isPipeline(value: unknown): value is DashboardStatus["latest_pipeline"] {
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

/** Snapshot lama belum membawa field ini; yang ada harus tetap berbentuk benar. */
function isAbsentOr<T>(value: unknown, sah: (value: unknown) => value is T): boolean {
  return value === undefined || sah(value);
}

function isStageTimes(value: unknown): value is Array<{ id: string; at: string }> | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (waktu) => hasKeys(waktu, ["id", "at"]) && isString(waktu.id) && isString(waktu.at),
      ))
  );
}

function isStages(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((stage) => typeof stage === "string");
}

/** Kunci wajib harus ada, kunci di luar daftar (wajib + opsional) ditolak. */
function hasKeys(
  value: unknown,
  wajib: string[],
  opsional: string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const kunci = Object.keys(value);
  return (
    wajib.every((key) => Object.hasOwn(value, key)) &&
    kunci.every((key) => wajib.includes(key) || opsional.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is StatusValue {
  return typeof value === "string" && statusValues.has(value);
}

function isInfraStatus(value: unknown): value is DashboardStatus["infra"]["jenkins"] {
  return typeof value === "string" && infraStatusValues.has(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
