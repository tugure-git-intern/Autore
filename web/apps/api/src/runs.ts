import { type RunsPayload, validateRuns } from "@autore/contracts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Argumen tetap: tidak ada potongan dari permintaan HTTP yang masuk ke argv. */
export const RUNS_ARGS = ["runs", "--json", "--days", "7", "--limit", "5"] as const;

const CACHE_MS = 60_000;
const HARI_MS = 86_400_000;

/** Runner menerima argv, bukan perintah bebas — pengujian bisa menyuntiknya tanpa proses nyata. */
export type RunRuns = (argv: readonly string[]) => Promise<string>;

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


