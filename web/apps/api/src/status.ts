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

export interface DashboardStatus {
  system_status: StatusValue;
  infra: { jenkins: "active" | "inactive" | "unknown"; nexus: "active" | "inactive" | "unknown" };
  stats: { total_apps: number; running_containers: number };
  applications: Array<{
    id: string;
    name: string;
    status: StatusValue;
    last_build: string | null;
    commit_sha: string | null;
    security_issues: number;
  }>;
  latest_pipeline: {
    status: StatusValue;
    failure_reason: string | null;
    stages: string[] | Array<{ id: string; label: string; status: StatusValue }>;
    security_summary: string | null;
    commit_sha: string | null;
    author: string | null;
    raw_log: string[];
  };
}

let lastGood: DashboardStatus | undefined;

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
): Promise<{ data: DashboardStatus; stale: boolean }> {
  try {
    const data = parseDashboardStatus(await run());
    lastGood = data;
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
  if (!hasExactKeys(value, ["system_status", "infra", "stats", "applications", "latest_pipeline"])) {
    return false;
  }

  return (
    isStatus(value.system_status) &&
    isInfra(value.infra) &&
    isStats(value.stats) &&
    Array.isArray(value.applications) &&
    value.applications.every(isApplication) &&
    isPipeline(value.latest_pipeline)
  );
}

function isInfra(value: unknown): value is DashboardStatus["infra"] {
  return (
    hasExactKeys(value, ["jenkins", "nexus"]) &&
    isInfraStatus(value.jenkins) &&
    isInfraStatus(value.nexus)
  );
}

function isStats(value: unknown): value is DashboardStatus["stats"] {
  return (
    hasExactKeys(value, ["total_apps", "running_containers"]) &&
    isCount(value.total_apps) &&
    isCount(value.running_containers)
  );
}

function isApplication(value: unknown): value is DashboardStatus["applications"][number] {
  return (
    hasExactKeys(value, [
      "id",
      "name",
      "status",
      "last_build",
      "commit_sha",
      "security_issues",
    ]) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isStatus(value.status) &&
    isNullableString(value.last_build) &&
    isNullableString(value.commit_sha) &&
    isCount(value.security_issues)
  );
}

function isPipeline(value: unknown): value is DashboardStatus["latest_pipeline"] {
  return (
    hasExactKeys(value, [
      "status",
      "failure_reason",
      "stages",
      "security_summary",
      "commit_sha",
      "author",
      "raw_log",
    ]) &&
    isStatus(value.status) &&
    isNullableString(value.failure_reason) &&
    isStages(value.stages) &&
    isNullableString(value.security_summary) &&
    isNullableString(value.commit_sha) &&
    isNullableString(value.author) &&
    Array.isArray(value.raw_log) &&
    value.raw_log.every((line) => typeof line === "string")
  );
}

function isStages(value: unknown): value is DashboardStatus["latest_pipeline"]["stages"] {
  return (
    Array.isArray(value) &&
    value.every(
      (stage) =>
        typeof stage === "string" ||
        (hasExactKeys(stage, ["id", "label", "status"]) &&
          typeof stage.id === "string" &&
          typeof stage.label === "string" &&
          isStatus(stage.status)),
    )
  );
}

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
