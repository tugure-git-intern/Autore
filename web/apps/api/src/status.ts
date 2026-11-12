import {
  type DashboardStatus,
  type StaleReason,
  validateDashboardStatus,
} from "@autore/contracts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export type RunAutore = () => Promise<string>;

export type StatusResult = {
  data: DashboardStatus;
  stale: boolean;
  stale_reason?: StaleReason;
};

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
      timeout: 15_000,
    },
  );
  return stdout;
}

export async function loadDashboardStatus(
  run: RunAutore = runAutore,
  clock: () => number = () => Date.now(),
): Promise<StatusResult> {
  const sekarang = clock();
  if (run === lastRunner && lastGood && sekarang - lastGoodAt < CACHE_STATUS_MS) {
    return { data: lastGood, stale: false };
  }

  let keluaran: string;
  try {
    keluaran = await run();
  } catch (error) {
    if (lastGood) return { data: lastGood, stale: true, stale_reason: "command_failed" };
    throw error;
  }

  let data: DashboardStatus;
  try {
    data = parseDashboardStatus(keluaran);
  } catch (error) {
    if (lastGood) return { data: lastGood, stale: true, stale_reason: "invalid_payload" };
    throw error;
  }

  lastRunner = run;
  lastGood = data;
  lastGoodAt = sekarang;
  return { data, stale: false };
}

function parseDashboardStatus(stdout: string): DashboardStatus {
  try {
    return validateDashboardStatus(JSON.parse(stdout) as unknown);
  } catch {
    throw new Error("invalid Autore status JSON");
  }
}
