import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { pathToFileURL } from "node:url";
import { loadDashboardStatus, runAutore, type RunAutore } from "./status";

export function createApp(run: RunAutore = runAutore) {
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

  return app;
}

export const app = createApp();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // PORT override exists so a smoke test can run beside the deployed 9121 API.
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: Number(process.env.PORT ?? 9121) });
}
