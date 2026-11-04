import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { pathToFileURL } from "node:url";
import { hatchActions, spawnAutore, type ActionResult, type Actions } from "./actions";
import { loadDashboardStatus, runAutore, type RunAutore } from "./status";

/**
 * Aksi (deploy/scan) membaca konfigurasi unit. Tanpa `AUTORE_WORKSPACE` aksi
 * ditolak 503 — menebak `~/.autore-workspace` akan menyentuh direktori yang salah.
 */
function configuredActions(run: RunAutore): Actions {
  return hatchActions({
    workspace: process.env.AUTORE_WORKSPACE ?? "",
    run,
    spawn: spawnAutore,
    deployApp: process.env.AUTORE_DEPLOY_APP ?? "",
  });
}

/** Body scan wajib `{"app":"<id>"}`: satu kunci, string tidak kosong, tidak ada tambahan. */
async function readScanBody(
  request: Request,
): Promise<{ ok: true; app: string } | { ok: false; error: string }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { ok: false, error: 'body harus JSON {"app":"<id aplikasi>"}' };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'body harus JSON {"app":"<id aplikasi>"}' };
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "app")) {
    return { ok: false, error: "body hanya boleh memuat kunci app" };
  }
  const app = record.app;
  if (typeof app !== "string" || !app.trim()) {
    return { ok: false, error: "app harus id aplikasi berupa string yang tidak kosong" };
  }
  return { ok: true, app: app.trim() };
}

/** HTTP status mengikuti hasil aksi; body-nya sama persis dengan hasil itu. */
function reply(c: Context, result: ActionResult) {
  c.header("Cache-Control", "no-store");
  return c.json(result, result.status);
}

export function createApp(run: RunAutore = runAutore, actions: Actions = configuredActions(run)) {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/api/status", async (c) => {
    try {
      const status = await loadDashboardStatus(run);
      c.header("Cache-Control", "no-store");
      return c.json(status);
    } catch {
      c.header("Cache-Control", "no-store");
      return c.json({ error: "Autore status unavailable" }, 503);
    }
  });

  // Body deploy sengaja tidak dibaca: targetnya milik server, bukan milik pemanggil.
  app.post("/api/actions/deploy", async (c) => reply(c, await actions.run("deploy")));

  app.post("/api/actions/scan", async (c) => {
    const body = await readScanBody(c.req.raw);
    c.header("Cache-Control", "no-store");
    if (!body.ok) return c.json({ ok: false, status: 400 as const, error: body.error }, 400);
    return reply(c, await actions.run("scan", body.app));
  });

  return app;
}

export const app = createApp();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // PORT override exists so a smoke test can run beside the deployed 9121 API.
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: Number(process.env.PORT ?? 9121) });
}
