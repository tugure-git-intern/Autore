import { hasExactKeys, isCount } from "./guards";

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

/** Mirrors `autore runs --json`. Numbers are integers; text is "" when unavailable. */
export type RunsPayload = {
  generated_at: string;
  window_days: number;
  runs: RunRecord[];
  daily: DailyPoint[];
  totals: RunTotals;
};

const runStatuses = new Set<string>(["passed", "failed", "running"]);
const RUN_KEYS = [
  "app",
  "number",
  "status",
  "duration_ms",
  "started_at",
  "commit_sha",
  "author",
  "url",
];
const PAYLOAD_KEYS = ["generated_at", "window_days", "runs", "daily", "totals"];

export function isRunsPayload(raw: unknown): raw is RunsPayload {
  return (
    hasExactKeys(raw, PAYLOAD_KEYS) &&
    typeof raw.generated_at === "string" &&
    isCount(raw.window_days) &&
    Array.isArray(raw.runs) &&
    raw.runs.every(isRun) &&
    Array.isArray(raw.daily) &&
    raw.daily.every(isDaily) &&
    hasExactKeys(raw.totals, ["passed", "failed", "running"]) &&
    isCount(raw.totals.passed) &&
    isCount(raw.totals.failed) &&
    isCount(raw.totals.running)
  );
}

export function validateRuns(raw: unknown): RunsPayload {
  if (!isRunsPayload(raw)) throw new Error("invalid runs payload");
  return raw;
}

export function isRun(value: unknown): value is RunRecord {
  return (
    hasExactKeys(value, RUN_KEYS) &&
    typeof value.app === "string" &&
    isCount(value.number) &&
    typeof value.status === "string" &&
    runStatuses.has(value.status) &&
    isCount(value.duration_ms) &&
    typeof value.started_at === "string" &&
    typeof value.commit_sha === "string" &&
    typeof value.author === "string" &&
    typeof value.url === "string"
  );
}

export function isDaily(value: unknown): value is DailyPoint {
  return (
    hasExactKeys(value, ["date", "passed", "failed"]) &&
    typeof value.date === "string" &&
    isCount(value.passed) &&
    isCount(value.failed)
  );
}