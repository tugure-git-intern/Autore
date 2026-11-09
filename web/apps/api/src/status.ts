import { type DashboardStatus, validateDashboardStatus } from "@autore/contracts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export type RunAutore = () => Promise<string>;

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
    return validateDashboardStatus(JSON.parse(stdout) as unknown);
  } catch {
    throw new Error("invalid Autore status JSON");
  }
}

