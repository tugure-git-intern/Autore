import { hasExactKeys, isCount } from "./guards";

export type ActiveStatus = "running" | "queued";

export type ActivePipeline = {
  app: string;
  /** 0 untuk yang masih menunggu — belum ada build. */
  number: number;
  status: ActiveStatus;
  /** CLI mengirim "" (bukan null) saat Jenkins tidak melaporkannya. */
  branch: string;
  commit_sha: string;
  author: string;
  started_at: string;
  url: string;
};

export type ActiveCounts = { running: number; queued: number };

/** Mirrors `autore active --json`. */
export type ActivePayload = {
  generated_at: string;
  active: ActivePipeline[];
  counts: ActiveCounts;
};

const activeStatuses = new Set<string>(["running", "queued"]);
const PIPELINE_KEYS = [
  "app",
  "number",
  "status",
  "branch",
  "commit_sha",
  "author",
  "started_at",
  "url",
];
const PAYLOAD_KEYS = ["generated_at", "active", "counts"];

export function isActivePayload(raw: unknown): raw is ActivePayload {
  return (
    hasExactKeys(raw, PAYLOAD_KEYS) &&
    typeof raw.generated_at === "string" &&
    Array.isArray(raw.active) &&
    raw.active.every(isActivePipeline) &&
    hasExactKeys(raw.counts, ["running", "queued"]) &&
    isCount(raw.counts.running) &&
    isCount(raw.counts.queued)
  );
}

export function validateActive(raw: unknown): ActivePayload {
  if (!isActivePayload(raw)) throw new Error("invalid active payload");
  return raw;
}

export function isActivePipeline(value: unknown): value is ActivePipeline {
  return (
    hasExactKeys(value, PIPELINE_KEYS) &&
    typeof value.app === "string" &&
    isCount(value.number) &&
    typeof value.status === "string" &&
    activeStatuses.has(value.status) &&
    typeof value.branch === "string" &&
    typeof value.commit_sha === "string" &&
    typeof value.author === "string" &&
    typeof value.started_at === "string" &&
    typeof value.url === "string"
  );
}