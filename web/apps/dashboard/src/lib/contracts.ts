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
  /** Snapshot lama dari CLI sebelum Phase 6 tidak membawa field ini. */
  deployed?: boolean;
};

/** Ringkasan kesehatan repo: kelas tiap baris registry + skor terbobot. */
export type RepositoryHealth = {
  score_percent: number;
  total_repos: number;
  gold: number;
  silver: number;
  bronze: number;
};

export type StageTime = { id: string; at: string };

export type DashboardStatus = {
  system_status: StatusValue;
  infra: { jenkins: InfraStatus; nexus: InfraStatus };
  stats: { total_apps: number; running_containers: number };
  repository_health: RepositoryHealth;
  applications: ApplicationRecord[];
  latest_pipeline: {
    status: StatusValue;
    /** CLI sends "" (never null) when the value is unavailable. */
    failure_reason: string;
    /** Started stage ids in execution order. No per-stage pass/fail exists in the contract. */
    stages: string[];
    /** Waktu mulai tiap tahap. Belum ada pada snapshot yang ditulis CLI lama. */
    stage_times?: StageTime[];
    finished_at?: string;
    gates_passed?: number;
    gates_total?: number;
    security_summary: string;
    commit_sha: string;
    author: string;
    raw_log: string[];
  };
};

export type RunStatus = "passed" | "failed" | "running";

export type RunRecord = {
  app: string;
  number: number;
  status: RunStatus;
  duration_ms: number;
  started_at: string;
  commit_sha: string;
  author: string;
  url: string;
};

export type DailyPoint = { date: string; passed: number; failed: number };

export type RunTotals = { passed: number; failed: number; running: number };

/** Mirrors `autore runs --json` (diteruskan apa adanya oleh Hono). */
export type RunsPayload = {
  generated_at: string;
  window_days: number;
  runs: RunRecord[];
  daily: DailyPoint[];
  totals: RunTotals;
};

export type ApiStatusResponse = { data: DashboardStatus; stale: boolean };

export type ApiRunsResponse = { data: RunsPayload; stale: boolean };

export type ActiveStatus = "running" | "queued";

export type ActivePipeline = {
  app: string;
  /** 0 untuk yang masih menunggu — belum ada build. */
  number: number;
  status: ActiveStatus;
  /** CLI sends "" (never null) when Jenkins does not report it. */
  branch: string;
  commit_sha: string;
  author: string;
  started_at: string;
  url: string;
};

export type ActiveCounts = { running: number; queued: number };

/** Mirrors `autore active --json` (diteruskan apa adanya oleh Hono). */
export type ActivePayload = {
  generated_at: string;
  active: ActivePipeline[];
  counts: ActiveCounts;
};

export type ApiActiveResponse = { data: ActivePayload; stale: boolean };

/** CLI sends "" (never null) for unavailable text. Empty must render as a dash, not as a fake value. */
export function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}