import { type ActivePayload, validateActive } from "@autore/contracts";
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

/** Runner menerima argv, bukan perintah bebas — pengujian bisa menyuntiknya. */
export type RunActive = (argv: readonly string[]) => Promise<string>;

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


