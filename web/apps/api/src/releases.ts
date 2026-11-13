import {
  foldReleaseEvents,
  parseReleaseEvents,
  type FoldResult,
  type ReleaseEvent,
} from "@autore/contracts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ReleaseResult = { data: FoldResult; stale: boolean };
export type ReleaseLoader = (app: string) => Promise<ReleaseResult>;

export async function runReleaseStatus(): Promise<string> {
  const { stdout } = await execFileAsync(
    process.env.AUTORE_BIN || "autore",
    ["release", "status", "--json"],
    {
      encoding: "utf8",
      env: process.env,
      shell: false,
      timeout: 15_000,
    },
  );
  return stdout;
}

export async function loadReleases(
  app: string,
  run: () => Promise<string> = runReleaseStatus,
): Promise<ReleaseResult> {
  const payload = parseReleaseEvents(JSON.parse(await run()) as unknown);
  const events: ReleaseEvent[] = payload.events.filter((event) => event.app === app);
  return { data: foldReleaseEvents(events), stale: false };
}
