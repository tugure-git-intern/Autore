import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "@auth/core/jwt";
import type { Context, MiddlewareHandler } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReleaseEvent } from "@autore/contracts";
import type { ActionResult } from "./actions";
import { createApp, type ActiveLoader, type RunsLoader, type SbomLoader } from "./index";
import { lepasSemuaKunci } from "./kunci";
import { hatchApprovals } from "./release-approval";

const SECRET = randomBytes(40).toString("hex");
const COMMIT = "b".repeat(40);
const APP = "tes-testing";
const idRelease = (build: number) => `${APP}:${COMMIT}:${build}`;
const DIGEST = "sha256:" + "2".repeat(64);

/** Cookie asli dari `encode()`: jalur dekripsi JWE yang diuji sama dengan dashboard. */
const cookie = (login: string, role?: string) =>
  encode({
    token: role ? { login, role, sub: "1" } : { login, sub: "1" },
    secret: SECRET,
    salt: "authjs.session-token",
    maxAge: 3600,
  });

function ev(overrides: Partial<ReleaseEvent> = {}): ReleaseEvent {
  return {
    id: "evt-1",
    ts: "2026-11-13T04:00:00Z",
    kind: "requested",
    app: APP,
    environment: "staging",
    request_id: "req-1",
    commit: COMMIT,
    build_number: 1,
    actor: "operator",
    ...overrides,
  };
}

/** Rantai sampai staging sehat: release berakhir di menunggu_persetujuan. */
function menungguPersetujuan(build: number): ReleaseEvent[] {
  return [
    ev({ id: `req-${build}`, build_number: build }),
    ev({ id: `build-${build}`, kind: "build_started", build_number: build }),
    ev({ id: `digest-${build}`, kind: "digest_verified", digest: DIGEST, build_number: build }),
    ev({
      id: `deploy-stg-${build}`,
      kind: "deploy_result",
      digest: DIGEST,
      deployment_id: `dep-stg-${build}`,
      outcome: "success",
      active_before: null,
      active_after: { deployment_id: `dep-stg-${build}`, digest: DIGEST },
      build_number: build,
    }),
  ];
}

function ledgerTemp(events: ReleaseEvent[]): string {
  const dir = mkdtempSync(join(tmpdir(), "autore-rute-"));
  const berkas = join(dir, "release-state.json");
  writeFileSync(berkas, JSON.stringify({ version: 1, events }, null, 2), "utf8");
  return berkas;
}

function eventsDi(berkas: string): ReleaseEvent[] {
  return (JSON.parse(readFileSync(berkas, "utf8")) as { events: ReleaseEvent[] }).events;
}

// Loader di luar sasaran tes: tipenya cukup, isinya kosong supaya tidak menyentuh
// jaringan atau berkas sungguhan.
const runsLoader = (async () => ({ data: {} as never, stale: false })) as unknown as RunsLoader;
const activeLoader = (async () => ({ data: {} as never, stale: false })) as unknown as ActiveLoader;
const sbomLoader = (async () => ({ data: {} as never, stale: false })) as unknown as SbomLoader;

/** Rate limit dilewati: beberapa request berurutan dalam satu tes bukan sasaran di sini. */
const tanpaLimit = (async (_c: Context, next: () => Promise<void>) => {
  await next();
}) as unknown as MiddlewareHandler;

function api(berkas: string) {
  const run = async (kind: "deploy" | "scan" | "quick-start"): Promise<ActionResult> => ({
    ok: true,
    status: 200,
    action: kind,
    target: APP,
    output: "lulus",
  });
  return createApp(
    undefined,
    {
      run,
      quickStart: async () => ({
        ok: true,
        status: 200,
        action: "quick-start",
        target: APP,
        output: "lulus",
      }),
    },
    runsLoader,
    { secret: SECRET },
    activeLoader,
    sbomLoader,
    () => 0,
    undefined,
    undefined,
    tanpaLimit,
    hatchApprovals({ ledger: () => berkas, clock: () => "2026-11-13T05:00:00Z" }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  lepasSemuaKunci();
});

describe("gerbang role endpoint approval", () => {
  it("dev ditolak approve (403) dan tidak ada event tertulis", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:dev");
    const app = api(berkas);

    const tolak = await app.request(`http://localhost/api/releases/${idRelease(1)}/approve`, {
      method: "POST",
      headers: { cookie: `authjs.session-token=${await cookie("budi")}` },
    });
    expect(tolak.status).toBe(403);

    // Login yang sama tetap boleh aksi tulis biasa: dev hanya kurang untuk approval.
    const deploy = await app.request("http://localhost/api/actions/deploy", {
      method: "POST",
      headers: { cookie: `authjs.session-token=${await cookie("budi")}`, "content-type": "application/json" },
      body: JSON.stringify({ app: APP }),
    });
    expect(deploy.status).toBe(200);
    expect(eventsDi(berkas).filter((event) => event.kind === "approved")).toHaveLength(0);
  });

  it("qa boleh approve walau tokennya tidak membawa role", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:qa");
    const res = await api(berkas).request(`http://localhost/api/releases/${idRelease(1)}/approve`, {
      method: "POST",
      headers: { cookie: `authjs.session-token=${await cookie("budi")}` },
    });

    expect(res.status).toBe(200);
    expect(eventsDi(berkas).filter((event) => event.kind === "approved")).toHaveLength(1);
  });

  it("admin boleh approve", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "tugure-git-intern:admin");
    const res = await api(berkas).request(`http://localhost/api/releases/${idRelease(1)}/approve`, {
      method: "POST",
      headers: { cookie: `authjs.session-token=${await cookie("Tugure-Git-Intern")}` },
    });

    expect(res.status).toBe(200);
    expect(eventsDi(berkas)[4]).toMatchObject({ kind: "approved", actor: "Tugure-Git-Intern" });
  });

  it("role di token tidak dipercaya: token ber-role admin ditolak bila allowlist bilang dev", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:dev");
    const res = await api(berkas).request(`http://localhost/api/releases/${idRelease(1)}/approve`, {
      method: "POST",
      headers: { cookie: `authjs.session-token=${await cookie("budi", "admin")}` },
    });

    expect(res.status).toBe(403);
    expect(eventsDi(berkas)).toHaveLength(4);
  });

  it("login di luar whitelist ditolak 403", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "orang-lain:admin");
    const res = await api(berkas).request(`http://localhost/api/releases/${idRelease(1)}/approve`, {
      method: "POST",
      headers: { cookie: `authjs.session-token=${await cookie("budi")}` },
    });

    expect(res.status).toBe(403);
    expect(eventsDi(berkas)).toHaveLength(4);
  });

  it("promosi dev -> qa berlaku pada request berikutnya tanpa login ulang", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:dev");
    const app = api(berkas);
    const sesi = `authjs.session-token=${await cookie("budi")}`;
    const jalur = `http://localhost/api/releases/${idRelease(1)}/approve`;

    expect((await app.request(jalur, { method: "POST", headers: { cookie: sesi } })).status).toBe(403);

    // Cookie yang sama, tanpa login ulang: allowlist dibaca ulang tiap request.
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:qa");
    expect((await app.request(jalur, { method: "POST", headers: { cookie: sesi } })).status).toBe(200);
  });

  it("demosi admin -> dev menolak request tulis berikutnya tanpa login ulang", async () => {
    const berkas = ledgerTemp([...menungguPersetujuan(1), ...menungguPersetujuan(2)]);
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:admin");
    const app = api(berkas);
    const sesi = `authjs.session-token=${await cookie("budi")}`;

    const pertama = await app.request(`http://localhost/api/releases/${idRelease(1)}/approve`, {
      method: "POST",
      headers: { cookie: sesi },
    });
    expect(pertama.status).toBe(200);

    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:dev");
    const kedua = await app.request(`http://localhost/api/releases/${idRelease(2)}/approve`, {
      method: "POST",
      headers: { cookie: sesi },
    });
    expect(kedua.status).toBe(403);
    expect(eventsDi(berkas).filter((event) => event.kind === "approved")).toHaveLength(1);
  });

  it("tanpa AUTH_SECRET tetap 503 walau allowlist mengizinkan", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:admin");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    const app = api(berkas);
    // `auth.secret` eksplisit di tes ini diisi SECRET, jadi 503 hanya bisa datang
    // dari unit tanpa rahasia: buktikan lewat app kedua yang tidak diberi rahasia.
    const tanpaRahasia = createApp(
      undefined,
      {
        run: async () => ({ ok: true, status: 200, action: "deploy", target: APP, output: "lulus" }),
        quickStart: async () => ({
          ok: true,
          status: 200,
          action: "quick-start",
          target: APP,
          output: "lulus",
        }),
      },
      runsLoader,
      {},
      activeLoader,
      sbomLoader,
    );
    const res = await tanpaRahasia.request(`http://localhost/api/releases/${idRelease(1)}/approve`, {
      method: "POST",
      headers: { cookie: `authjs.session-token=${await cookie("budi")}` },
    });

    expect(res.status).toBe(503);
    expect(eventsDi(berkas)).toHaveLength(4);
    expect(app).toBeTruthy();
  });
});

describe("endpoint reject", () => {
  it("tanpa alasan 400, alasan kosong 400, dan tidak ada event ditulis", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:qa");
    const app = api(berkas);
    const sesi = `authjs.session-token=${await cookie("budi")}`;
    const jalur = `http://localhost/api/releases/${idRelease(1)}/reject`;

    for (const body of [undefined, {}, { alasan: "" }, { alasan: "   " }, { alasan: 42 }]) {
      const res = await app.request(jalur, {
        method: "POST",
        headers: { cookie: sesi, "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      expect(res.status).toBe(400);
    }
    expect(eventsDi(berkas)).toHaveLength(4);
  });

  it("reject sah mengubah status jadi ditolak dan mencatat alasan di ledger", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:qa");
    const res = await api(berkas).request(`http://localhost/api/releases/${idRelease(1)}/reject`, {
      method: "POST",
      headers: {
        cookie: `authjs.session-token=${await cookie("budi")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ alasan: "Regresi pembayaran klaim." }),
    });

    expect(res.status).toBe(200);
    expect(eventsDi(berkas)[4]).toMatchObject({
      kind: "rejected",
      error: "Regresi pembayaran klaim.",
      actor: "budi",
    });
  });

  it("dev ditolak reject (403)", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:dev");
    const res = await api(berkas).request(`http://localhost/api/releases/${idRelease(1)}/reject`, {
      method: "POST",
      headers: {
        cookie: `authjs.session-token=${await cookie("budi")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ alasan: "tidak setuju" }),
    });

    expect(res.status).toBe(403);
    expect(eventsDi(berkas)).toHaveLength(4);
  });
});

describe("approve bersamaan lewat HTTP", () => {
  it("dua approve paralel hanya menulis satu event", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1));
    vi.stubEnv("AUTORE_ALLOWED_USERS", "budi:qa,siti:admin");
    const app = api(berkas);
    const jalur = `http://localhost/api/releases/${idRelease(1)}/approve`;
    const [a, b] = await Promise.all([
      app.request(jalur, {
        method: "POST",
        headers: { cookie: `authjs.session-token=${await cookie("budi")}` },
      }),
      app.request(jalur, {
        method: "POST",
        headers: { cookie: `authjs.session-token=${await cookie("siti")}` },
      }),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(eventsDi(berkas).filter((event) => event.kind === "approved")).toHaveLength(1);
  });
});
