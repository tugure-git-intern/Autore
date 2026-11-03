// Mirrors `autore status --json` exactly. Node only forwards this; the UI never invents values.
export type StatusValue =
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "unknown"
  | "pending"
  | "skipped";

export type InfraStatus = "active" | "inactive" | "unknown";

export type ApplicationRecord = {
  id: string;
  name: string;
  status: StatusValue;
  last_build: string | null;
  commit_sha: string | null;
  security_issues: number;
};

export type DashboardStatus = {
  system_status: StatusValue;
  infra: { jenkins: InfraStatus; nexus: InfraStatus };
  stats: { total_apps: number; running_containers: number };
  applications: ApplicationRecord[];
  latest_pipeline: {
    status: StatusValue;
    /** CLI sends "" (never null) when the value is unavailable. */
    failure_reason: string;
    /** Started stage ids in execution order. No per-stage pass/fail exists in the contract. */
    stages: string[];
    security_summary: string;
    commit_sha: string;
    author: string;
    raw_log: string[];
  };
};

export type ApiStatusResponse = { data: DashboardStatus; stale: boolean };

/** CLI sends "" (never null) for unavailable text. Empty must render as a dash, not as a fake value. */
export function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}