import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { pathToFileURL } from "node:url";
import { hatchActions, spawnAutore, type ActionResult, type Actions } from "./actions";
import { loadDashboardStatus, runAutore, type RunAutore } from "./status";
import { getRuns, type RunsPayload } from "./runs";
import { getActive, type ActivePayload } from "./active";
import { parseAllowed, requireSession } from "./session";

export type RunsLoader = () => Promise<{ data: RunsPayload; stale: boolean }>;
export type ActiveLoader = () => Promise<{ data: ActivePayload; stale: boolean }>;

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

export function createApp(
  run: RunAutore = runAutore,
  actions: Actions = configuredActions(run),
  runs: RunsLoader = () => getRuns(),
  auth: { secret?: string; allowed?: string[] } = {},
  active: ActiveLoader = () => getActive(),
) {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Hanya aksi yang butuh identitas; halaman read-only tetap terbuka dan unit
  // ini hanya listen di 127.0.0.1.
  app.use("/api/actions/*", requireSession(auth));

  // Riwayat build: cache 60 detik di dalam `getRuns`; Jenkins diam tetap 200 + stale.
  app.get("/api/runs", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await runs());
  });

  // Data live untuk section "Active Pipelines": cache 5 detik di dalam `getActive`
  // supaya polling 10 detik dari klien tidak menambah beban Jenkins.
  app.get("/api/active", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await active());
  });

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

export const app = createApp(undefined, undefined, undefined, {
  // Rahasia dibaca saat start; unit di-restart kalau `.env` berubah.
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  allowed: parseAllowed(process.env.AUTORE_ALLOWED_USERS),
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // PORT override exists so a smoke test can run beside the deployed 9121 API.
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: Number(process.env.PORT ?? 9121) });
}
