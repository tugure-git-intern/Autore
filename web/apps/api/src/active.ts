import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Argumen tetap: tidak ada potongan dari permintaan HTTP yang masuk ke argv. */
export const ACTIVE_ARGS = ["active", "--json"] as const;

/**
 * Lima detik: klien polling tiap 10 detik, jadi Jenkins paling banyak menerima
 * ~2 refresh per menit — beberapa tab terbuka tidak menambah beban.
 */
const CACHE_MS = 5_000;

export type ActiveStatus = "running" | "queued";

export interface ActivePipeline {
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
}

/** Mirrors `autore active --json`. */
export interface ActivePayload {
  generated_at: string;
  active: ActivePipeline[];
  counts: { running: number; queued: number };
}

/** Runner menerima argv, bukan perintah bebas — pengujian bisa menyuntiknya. */
export type RunActive = (argv: readonly string[]) => Promise<string>;

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

let lastGood: ActivePayload | undefined;
let lastGoodAt = 0;

async function runActiveCli(argv: readonly string[] = ACTIVE_ARGS): Promise<string> {
  const { stdout } = await execFileAsync(process.env.AUTORE_BIN || "autore", [...argv], {
    encoding: "utf8",
    env: process.env,
    shell: false,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

/** Tidak ada yang jalan itu jawaban yang sah; ini dipakai saat Jenkins tidak bisa ditanya. */
export function emptyActive(now: number = Date.now()): ActivePayload {
  return {
    generated_at: new Date(now).toISOString(),
    active: [],
    counts: { running: 0, queued: 0 },
  };
}

export function validateActive(raw: unknown): ActivePayload {
  if (!hasKeys(raw, PAYLOAD_KEYS)) throw new Error("invalid active payload");
  if (typeof raw.generated_at !== "string") throw new Error("invalid active payload");
  if (!Array.isArray(raw.active) || !raw.active.every(isPipeline)) {
    throw new Error("invalid active payload");
  }
  if (!hasKeys(raw.counts, ["running", "queued"])) throw new Error("invalid active payload");
  if (!isCount(raw.counts.running) || !isCount(raw.counts.queued)) {
    throw new Error("invalid active payload");
  }
  return raw as unknown as ActivePayload;
}

/**
 * Cache 5 detik + data terakhir yang baik saat CLI gagal. Endpoint tidak pernah
 * 5xx karena Jenkins diam: kartu lama tetap tampil dengan penanda `stale`.
 */
export async function getActive(
  runner: RunActive = runActiveCli,
  now: () => number = Date.now,
): Promise<{ data: ActivePayload; stale: boolean }> {
  const cap = now();
  if (lastGood && cap - lastGoodAt < CACHE_MS) return { data: lastGood, stale: false };

  try {
    const data = validateActive(JSON.parse(await runner(ACTIVE_ARGS)));
    lastGood = data;
    lastGoodAt = cap;
    return { data, stale: false };
  } catch {
    if (lastGood) return { data: lastGood, stale: true };
    return { data: emptyActive(cap), stale: true };
  }
}

function isPipeline(value: unknown): value is ActivePipeline {
  return (
    hasKeys(value, PIPELINE_KEYS) &&
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

function hasKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
