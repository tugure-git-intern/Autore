import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Argumen tetap: tidak ada potongan dari permintaan HTTP yang masuk ke argv. */
export const RUNS_ARGS = ["runs", "--json", "--days", "7", "--limit", "5"] as const;

const CACHE_MS = 60_000;
const HARI_MS = 86_400_000;

export type RunStatus = "passed" | "failed" | "running";

export interface RunRecord {
  app: string;
  number: number;
  status: RunStatus;
  duration_ms: number;
  started_at: string;
  commit_sha: string;
  author: string;
  url: string;
}

/** Mirrors `autore runs --json`. Numbers are integers; text is "" when unavailable. */
export interface RunsPayload {
  generated_at: string;
  window_days: number;
  runs: RunRecord[];
  daily: Array<{ date: string; passed: number; failed: number }>;
  totals: { passed: number; failed: number; running: number };
}

/** Runner menerima argv, bukan perintah bebas — pengujian bisa menyuntiknya tanpa proses nyata. */
export type RunRuns = (argv: readonly string[]) => Promise<string>;

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

let lastGood: RunsPayload | undefined;
let lastGoodAt = 0;

async function runRunsCli(argv: readonly string[] = RUNS_ARGS): Promise<string> {
  const { stdout } = await execFileAsync(process.env.AUTORE_BIN || "autore", [...argv], {
    encoding: "utf8",
    env: process.env,
    shell: false,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

/**
 * Jendela nol untuk hari-hari yang belum punya build. Dikirim saat CLI belum bisa
 * dijalankan: grafik menampilkan sumbu kosong, bukan angka karangan.
 */
export function emptyRuns(now: number = Date.now()): RunsPayload {
  const hariIni = Math.floor(now / HARI_MS);
  return {
    generated_at: new Date(now).toISOString(),
    window_days: 7,
    runs: [],
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: new Date((hariIni - (6 - i)) * HARI_MS).toISOString().slice(0, 10),
      passed: 0,
      failed: 0,
    })),
    totals: { passed: 0, failed: 0, running: 0 },
  };
}

export function validateRuns(raw: unknown): RunsPayload {
  if (!hasKeys(raw, PAYLOAD_KEYS)) throw new Error("invalid runs payload");
  if (typeof raw.generated_at !== "string") throw new Error("invalid runs payload");
  if (!isCount(raw.window_days)) throw new Error("invalid runs payload");
  if (!Array.isArray(raw.runs) || !raw.runs.every(isRun)) throw new Error("invalid runs payload");
  if (!Array.isArray(raw.daily) || !raw.daily.every(isDaily)) throw new Error("invalid runs payload");
  if (!hasKeys(raw.totals, ["passed", "failed", "running"])) throw new Error("invalid runs payload");
  if (
    !isCount(raw.totals.passed) ||
    !isCount(raw.totals.failed) ||
    !isCount(raw.totals.running)
  ) {
    throw new Error("invalid runs payload");
  }
  return raw as unknown as RunsPayload;
}

/**
 * Cache 60 detik: Jenkins dipanggil paling banyak sekali per menit walau ada
 * beberapa tab terbuka. CLI gagal → data terakhir yang baik ditandai `stale`;
 * tanpa itu, jendela kosong. Endpoint tidak pernah 5xx karena Jenkins diam.
 */
export async function getRuns(
  runner: RunRuns = runRunsCli,
  now: () => number = Date.now,
): Promise<{ data: RunsPayload; stale: boolean }> {
  const cap = now();
  if (lastGood && cap - lastGoodAt < CACHE_MS) return { data: lastGood, stale: false };

  try {
    const data = validateRuns(JSON.parse(await runner(RUNS_ARGS)));
    lastGood = data;
    lastGoodAt = cap;
    return { data, stale: false };
  } catch {
    if (lastGood) return { data: lastGood, stale: true };
    return { data: emptyRuns(cap), stale: true };
  }
}

function isRun(value: unknown): value is RunRecord {
  return (
    hasKeys(value, RUN_KEYS) &&
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

function isDaily(value: unknown): value is RunsPayload["daily"][number] {
  return (
    hasKeys(value, ["date", "passed", "failed"]) &&
    typeof value.date === "string" &&
    isCount(value.passed) &&
    isCount(value.failed)
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
