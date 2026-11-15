import { homedir } from "node:os";
import { join } from "node:path";

/** Root workspace Autore: `AUTORE_WORKSPACE`, atau `~/autore-workspace`. */
export function jalurWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  const workspace = (env.AUTORE_WORKSPACE ?? "").trim();
  return workspace || join(env.HOME || homedir(), "autore-workspace");
}
