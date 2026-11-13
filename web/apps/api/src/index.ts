import { rateLimit } from "./rate-limit";
import { serve } from "@hono/node-server";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { pathToFileURL } from "node:url";
import { hatchActions, spawnAutore, type ActionResult, type Actions } from "./actions";
import { loadDashboardStatus, runAutore, type RunAutore } from "./status";
import type { ActivePayload, RunsPayload, SbomResult } from "@autore/contracts";
import { getRuns } from "./runs";
import { getActive } from "./active";
import { bacaBodyQuickStart, type HasilBaca } from "./quick-start";
import { hatchSbom } from "./sbom";
import { requireSession, type AuthApi, type Identitas } from "./session";
import { bacaAudit, type BarisAuditLengkap } from "./audit";
import { loadReleases, type ReleaseLoader } from "./releases";
import { hatchApprovals, type ApprovalHandler, type HasilKeputusan } from "./release-approval";

export type RunsLoader = () => Promise<{ data: RunsPayload; stale: boolean }>;
export type ActiveLoader = () => Promise<{ data: ActivePayload; stale: boolean }>;
export type SbomLoader = (app: string) => Promise<SbomResult>;
export type AuditLoader = (max?: number) => Promise<BarisAuditLengkap[]>;

/**
 * Aksi (deploy/scan) membaca konfigurasi unit. Tanpa `AUTORE_WORKSPACE` aksi
 * ditolak 503 — menebak `~/.autore-workspace` akan menyentuh direktori yang salah.
 */
function configuredActions(run: RunAutore): Actions {
  return hatchActions({
    workspace: process.env.AUTORE_WORKSPACE ?? "",
    run,
    spawn: spawnAutore,
  });
}

/** Sama seperti aksi: workspace dibaca dari unit, bukan ditebak. */
function configuredSbom(run: RunAutore): SbomLoader {
  const sbom = hatchSbom({
    workspace: process.env.AUTORE_WORKSPACE ?? "",
    run,
    spawn: spawnAutore,
  });
  return (app) => sbom.get(app);
}

/** Body scan wajib `{"app":"<id>"}`: satu kunci, string tidak kosong, tidak ada tambahan. */
async function readAppBody(
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

const MAX_QUICK_START_BODY = 4 * 1024;

/**
 * Body quick-start wajib `{"nama":"...","stack":"python|nodejs|java|go","kode":"contoh|kosong"}`.
 * Ukurannya dibatasi dua kali (content-length lalu panjang teks) supaya body raksasa
 * tidak pernah sampai ke validator, apalagi ke spawn.
 */
async function readQuickStartBody(request: Request): Promise<HasilBaca> {
  const panjang = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(panjang) && panjang > MAX_QUICK_START_BODY) {
    return { ok: false, error: `body terlalu besar (maks ${MAX_QUICK_START_BODY} byte)` };
  }

  let teks: string;
  try {
    teks = await request.text();
  } catch {
    return { ok: false, error: "body tidak bisa dibaca" };
  }
  if (teks.length > MAX_QUICK_START_BODY) {
    return { ok: false, error: `body terlalu besar (maks ${MAX_QUICK_START_BODY} byte)` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(teks);
  } catch {
    return { ok: false, error: 'body harus JSON {"nama":"...","stack":"python|nodejs|java|go"}' };
  }
  return bacaBodyQuickStart(parsed);
}

/** Body reject wajib `{"alasan":"..."}`: satu kunci, string tidak kosong. */
async function readAlasanBody(
  request: Request,
): Promise<{ ok: true; alasan: string } | { ok: false; error: string }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { ok: false, error: 'body harus JSON {"alasan":"<alasan penolakan>"}' };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'body harus JSON {"alasan":"<alasan penolakan>"}' };
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "alasan")) {
    return { ok: false, error: "body hanya boleh memuat kunci alasan" };
  }
  const alasan = record.alasan;
  if (typeof alasan !== "string" || !alasan.trim()) {
    return { ok: false, error: "alasan harus string yang tidak kosong" };
  }
  return { ok: true, alasan: alasan.trim() };
}

/** HTTP status mengikuti hasil aksi; body-nya sama persis dengan hasil itu. */
function replyKeputusan(c: Context, hasil: HasilKeputusan) {
  c.header("Cache-Control", "no-store");
  return c.json(hasil, hasil.status);
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
  auth: AuthApi = {},
  active: ActiveLoader = () => getActive(),
  sbom: SbomLoader = configuredSbom(run),
  clock: () => number = () => Date.now(),
  audit: AuditLoader = (max = 100) => bacaAudit(max),
  releases: ReleaseLoader = (app) => loadReleases(app),
  rateLimiter: MiddlewareHandler = rateLimit({ limit: 10, windowMs: 60_000, now: clock }),
  approvals: ApprovalHandler = hatchApprovals(),
) {
  const app = new Hono<{ Variables: { sesi: Identitas } }>();

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Hanya aksi yang butuh identitas; halaman read-only tetap terbuka dan unit
  // ini hanya listen di 127.0.0.1. Semua aksi (deploy, scan, quick-start) minimum
  // role `dev`; approve/reject punya gerbang sendiri di bawah.
  app.use("/api/actions/*", requireSession(auth, "dev"));
  app.use("/api/actions/*", rateLimiter);

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

  app.get("/api/releases", async (c) => {
    const app = c.req.query("app")?.trim();
    if (!app) return c.json({ error: "app wajib diisi" }, 400);
    try {
      return c.json(await releases(app));
    } catch {
      return c.json({ error: "gagal membaca event release" }, 502);
    }
  });

  // Keputusan approval: minimum role `qa`, dan role dihitung ulang dari allowlist
  // tiap request (bukan dari token) — demosi langsung berlaku tanpa login ulang.
  app.use("/api/releases/:id/approve", requireSession(auth, "qa"));
  app.use("/api/releases/:id/reject", requireSession(auth, "qa"));
  app.use("/api/releases/*", rateLimiter);

  // Approve idempoten: release yang sudah disetujui tetap 200 tanpa event kedua.
  app.post("/api/releases/:id/approve", async (c) => {
    return replyKeputusan(c, await approvals.approve(c.req.param("id"), c.get("sesi")));
  });

  // Reject wajib beralasan: alasan ditulis ke field `error` event rejected, jadi
  // tanpa alasan tidak ada yang bisa dicatat.
  app.post("/api/releases/:id/reject", async (c) => {
    const body = await readAlasanBody(c.req.raw);
    c.header("Cache-Control", "no-store");
    if (!body.ok) return c.json({ ok: false, status: 400 as const, error: body.error }, 400);
    return replyKeputusan(c, await approvals.reject(c.req.param("id"), c.get("sesi"), body.alasan));
  });

  app.get("/api/status", async (c) => {
    try {
      const status = await loadDashboardStatus(run, clock);
      c.header("Cache-Control", "no-store");
      return c.json(status);
    } catch {
      c.header("Cache-Control", "no-store");
      return c.json({ error: "Autore status unavailable" }, 503);
    }
  });

  // Daftar dependensi dari SBOM build terakhir. Read-only: tanpa sesi,
  // sama seperti GET /api/* lain (unit ini hanya listen di 127.0.0.1).
  app.get("/api/sbom/:app", async (c) => {
    c.header("Cache-Control", "no-store");
    const hasil = await sbom(c.req.param("app"));
    return hasil.ok ? c.json(hasil.data, 200) : c.json({ error: hasil.error }, hasil.status);
  });

  // Jejak aksi audit trail: read-only, tanpa sesi (sama seperti GET /api/* lain)
  app.get("/api/audit/log", async (c) => {
    c.header("Cache-Control", "no-store");
    const data = await audit(100);
    return c.json({ data, total: data.length });
  });

  // Target deploy datang dari body, sama seperti scan: tombol di dashboard selalu
  // menunjuk aplikasi yang sedang dibuka, jadi server tidak boleh memilih sendiri.
  // Identitas commit juga datang dari sesi, bukan body (audit trail).
  app.post("/api/actions/deploy", async (c) => {
    const body = await readAppBody(c.req.raw);
    c.header("Cache-Control", "no-store");
    if (!body.ok) return c.json({ ok: false, status: 400 as const, error: body.error }, 400);
    // Identitas author dari sesi (bukan body): commit deploy harus atas nama orang
    // yang menekan tombol, sama seperti quick-start.
    return reply(c, await actions.run("deploy", body.app, c.get("sesi")));
  });

  app.post("/api/actions/scan", async (c) => {
    const body = await readAppBody(c.req.raw);
    c.header("Cache-Control", "no-store");
    if (!body.ok) return c.json({ ok: false, status: 400 as const, error: body.error }, 400);
    // Sesi ikut diteruskan walau scan tidak menulis commit: audit log tetap butuh
    // tahu siapa yang menekan tombol.
    return reply(c, await actions.run("scan", body.app, c.get("sesi")));
  });

  // Aksi paling berat: repo GitHub PUBLIK + job Jenkins + push. Konfirmasi ganda ada
  // di UI; di sisi ini yang ditegakkan: sesi, validasi whitelist, lock `busy`, argv tetap.
  // Identitas author diambil dari sesi (bukan body) supaya audit trail menunjuk
  // orangnya, bukan bot.
  app.post("/api/actions/quick-start", async (c) => {
    const body = await readQuickStartBody(c.req.raw);
    c.header("Cache-Control", "no-store");
    if (!body.ok) return c.json({ ok: false, status: 400 as const, error: body.error }, 400);
    return reply(c, await actions.quickStart(body.nilai, c.get("sesi")));
  });

  return app;
}

export const app = createApp(undefined, undefined, undefined, {
  // Rahasia dibaca saat start; unit di-restart kalau `.env` berubah. Allowlist
  // tidak diambil di sini: `bacaAllowlist` membacanya ULANG tiap request.
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // PORT override exists so a smoke test can run beside the deployed 9121 API.
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: Number(process.env.PORT ?? 9121) });
}
