import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DashboardStatus } from "@autore/contracts";
import type { RunAutore } from "./status";

const fixture: DashboardStatus = {
  system_status: "idle",
  infra: { jenkins: "unknown", nexus: "unknown" },
  stats: { total_apps: 0, running_containers: 0 },
  repository_health: { score_percent: 0, total_repos: 0, gold: 0, silver: 0, bronze: 0 },
  applications: [],
  latest_pipeline: {
    status: "idle",
    failure_reason: "",
    stages: [],
    security_summary: "",
    commit_sha: "",
    author: "",
    raw_log: [],
  },
};

async function freshStatus() {
  vi.resetModules();
  return import("./status");
}

async function freshApp() {
  vi.resetModules();
  return import("./index");
}

describe("loadDashboardStatus", () => {
  it("accepts Rust empty-string fields and string stage ids", async () => {
    const { loadDashboardStatus } = await freshStatus();

    await expect(loadDashboardStatus(async () => JSON.stringify(fixture))).resolves.toEqual({
      data: fixture,
      stale: false,
    });
  });

  it("rejects nullable fields, stage objects, and extra fields", async () => {
    const { loadDashboardStatus } = await freshStatus();

    await expect(
      loadDashboardStatus(async () =>
        JSON.stringify({
          ...fixture,
          latest_pipeline: { ...fixture.latest_pipeline, failure_reason: null },
        }),
      ),
    ).rejects.toThrow("invalid Autore status JSON");
    await expect(
      loadDashboardStatus(async () =>
        JSON.stringify({
          ...fixture,
          latest_pipeline: { ...fixture.latest_pipeline, stages: [{ id: "build" }] },
        }),
      ),
    ).rejects.toThrow("invalid Autore status JSON");
    await expect(
      loadDashboardStatus(async () =>
        JSON.stringify({
          ...fixture,
          latest_pipeline: {
            ...fixture.latest_pipeline,
            stages: [{ id: "build", label: "Build", status: "passed" }],
          },
        }),
      ),
    ).rejects.toThrow("invalid Autore status JSON");
    await expect(
      loadDashboardStatus(async () => JSON.stringify({ ...fixture, unexpected: true })),
    ).rejects.toThrow("invalid Autore status JSON");
  });

  it("rejects malformed CLI JSON without a cache write", async () => {
    const { loadDashboardStatus } = await freshStatus();

    await expect(loadDashboardStatus(async () => "not-json")).rejects.toThrow(
      "invalid Autore status JSON",
    );
    await expect(
      loadDashboardStatus(async () => JSON.stringify({ ...fixture, system_status: "green" })),
    ).rejects.toThrow("invalid Autore status JSON");
    await expect(
      loadDashboardStatus(async () => JSON.stringify({ ...fixture, extra: true })),
    ).rejects.toThrow("invalid Autore status JSON");
    await expect(
      loadDashboardStatus(async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
  });

  it("returns stale last-known data after CLI failure", async () => {
    const { loadDashboardStatus } = await freshStatus();
    let sekarang = 1_000;

    await expect(
      loadDashboardStatus(async () => JSON.stringify(fixture), () => sekarang),
    ).resolves.toEqual({
      data: fixture,
      stale: false,
    });
    sekarang += 5_000;
    await expect(
      loadDashboardStatus(
        async () => {
          throw new Error("timeout");
        },
        () => sekarang,
      ),
    ).resolves.toEqual({ data: fixture, stale: true });
  });
});

describe("repository_health", () => {
  it("meneruskan angka apa adanya ke web", async () => {
    const { loadDashboardStatus } = await freshStatus();
    const sehat = {
      ...fixture,
      repository_health: { score_percent: 10, total_repos: 10, gold: 1, silver: 0, bronze: 9 },
    };

    await expect(
      loadDashboardStatus(async () => JSON.stringify(sehat)),
    ).resolves.toEqual({ data: sehat, stale: false });
  });

  it("menolak kunci yang hilang, nilai pecahan, dan kunci asing", async () => {
    const { loadDashboardStatus } = await freshStatus();
    const cases: unknown[] = [
      { ...fixture, repository_health: undefined },
      { ...fixture, repository_health: { total_repos: 0, gold: 0, silver: 0, bronze: 0 } },
      {
        ...fixture,
        repository_health: { score_percent: 10, total_repos: 10, gold: 1, silver: 0 },
      },
      {
        ...fixture,
        repository_health: { score_percent: 10, total_repos: 10, gold: 1.5, silver: 0, bronze: 8 },
      },
      {
        ...fixture,
        repository_health: { score_percent: -1, total_repos: 10, gold: 0, silver: 0, bronze: 10 },
      },
      {
        ...fixture,
        repository_health: {
          score_percent: 10,
          total_repos: 10,
          gold: 1,
          silver: 0,
          bronze: 9,
          platinum: 0,
        },
      },
    ];

    for (const payload of cases) {
      await expect(loadDashboardStatus(async () => JSON.stringify(payload))).rejects.toThrow(
        "invalid Autore status JSON",
      );
    }
  });

  it("menerima `deployed` boolean dan aplikasi lama tanpa field itu", async () => {
    const { loadDashboardStatus, resetStatusCache } = await freshStatus();
    const app = {
      id: "tes-web",
      name: "tes-web",
      status: "passed" as const,
      last_build: "2026-11-05T06:02:40Z",
      commit_sha: "feff447",
      security_issues: 0,
    };
    const baru = { ...fixture, applications: [{ ...app, deployed: true }] };
    const lama = { ...fixture, applications: [app] };

    await expect(
      loadDashboardStatus(async () => JSON.stringify(baru)),
    ).resolves.toEqual({ data: baru, stale: false });
    resetStatusCache();
    await expect(
      loadDashboardStatus(async () => JSON.stringify(lama)),
    ).resolves.toEqual({ data: lama, stale: false });
  });

  it("menolak `deployed` yang bukan boolean", async () => {
    const { loadDashboardStatus } = await freshStatus();
    const app = {
      id: "tes-web",
      name: "tes-web",
      status: "passed" as const,
      last_build: "",
      commit_sha: "",
      security_issues: 0,
    };

    await expect(
      loadDashboardStatus(async () =>
        JSON.stringify({ ...fixture, applications: [{ ...app, deployed: "ya" }] }),
      ),
    ).rejects.toThrow("invalid Autore status JSON");
  });

  it("menerima `author` audit trail dan aplikasi lama tanpa field itu", async () => {
    const { loadDashboardStatus, resetStatusCache } = await freshStatus();
    const app = {
      id: "audit-uji",
      name: "audit-uji",
      status: "passed" as const,
      last_build: "2026-11-05T14:00:00Z",
      commit_sha: "abc1234",
      security_issues: 0,
    };
    const baru = { ...fixture, applications: [{ ...app, author: "Alif Fadlan <alif@example.com>" }] };
    const lama = { ...fixture, applications: [app] };

    await expect(loadDashboardStatus(async () => JSON.stringify(baru))).resolves.toEqual({
      data: baru,
      stale: false,
    });
    resetStatusCache();
    await expect(loadDashboardStatus(async () => JSON.stringify(lama))).resolves.toEqual({
      data: lama,
      stale: false,
    });
  });

  it("menolak `author` yang bukan string", async () => {
    const { loadDashboardStatus } = await freshStatus();
    const app = {
      id: "tes-web",
      name: "tes-web",
      status: "passed" as const,
      last_build: "",
      commit_sha: "",
      security_issues: 0,
    };

    await expect(
      loadDashboardStatus(async () =>
        JSON.stringify({ ...fixture, applications: [{ ...app, author: 7 }] }),
      ),
    ).rejects.toThrow("invalid Autore status JSON");
  });
});

describe("status API", () => {
  it("returns 503 before any valid CLI response", async () => {
    const { createApp } = await freshApp();
    const app = createApp(async () => {
      throw new Error("offline");
    });

    const response = await app.request("http://localhost/api/status");

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Autore status unavailable" });
  });

  it("serves health and current validated status without storage", async () => {
    const { createApp } = await freshApp();
    const app = createApp(async () => JSON.stringify(fixture));

    const health = await app.request("http://localhost/healthz");
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });

    const status = await app.request("http://localhost/api/status");
    expect(status.status).toBe(200);
    expect(status.headers.get("Cache-Control")).toBe("no-store");
    await expect(status.json()).resolves.toEqual({ data: fixture, stale: false });
  });

  it("serves stale cached data after failure following success", async () => {
    const { createApp } = await freshApp();
    let calls = 0;
    let sekarang = 1_000;
    const app = createApp(
      async () => {
        calls += 1;
        if (calls === 1) return JSON.stringify(fixture);
        throw new Error("timeout");
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => sekarang,
    );

    const current = await app.request("http://localhost/api/status");
    await expect(current.json()).resolves.toEqual({ data: fixture, stale: false });

    // Cache TTL 5 detik: majukan waktu agar request kedua memicu runner yang gagal.
    sekarang += 5_000;
    const stale = await app.request("http://localhost/api/status");
    expect(stale.status).toBe(200);
    expect(stale.headers.get("Cache-Control")).toBe("no-store");
    await expect(stale.json()).resolves.toEqual({ data: fixture, stale: true });
  });

  it("does not pass browser input to command runner", async () => {
    const { createApp } = await freshApp();
    const calls: unknown[][] = [];
    const run: RunAutore = async (...args: unknown[]) => {
      calls.push(args);
      return JSON.stringify(fixture);
    };
    const app = createApp(run);

    const response = await app.request(
      "http://localhost/api/status?bin=autore%3Btouch%20%2Ftmp%2Fpwned&arg=--help",
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([[]]);
  });
});

describe("runAutore", () => {
  it("executes only fixed argv and passes AUTORE_WORKSPACE through unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-api-"));
    const log = join(dir, "argv.log");
    const bin = join(dir, "fake autore");
    await writeFile(
      bin,
      `#!/bin/sh\nprintf '%s\\n' "$AUTORE_WORKSPACE" "$@" > ${JSON.stringify(log)}\nprintf '%s' ${JSON.stringify(JSON.stringify(fixture))}\n`,
    );
    await chmod(bin, 0o755);

    const previousBin = process.env.AUTORE_BIN;
    const previousWorkspace = process.env.AUTORE_WORKSPACE;
    process.env.AUTORE_BIN = bin;
    process.env.AUTORE_WORKSPACE = dir;
    try {
      const { runAutore } = await freshStatus();
      expect(JSON.parse(await runAutore())).toEqual(fixture);
      expect((await readFile(log, "utf8")).split("\n").slice(0, 4)).toEqual([
        dir,
        "status",
        "--json",
        "",
      ]);
    } finally {
      if (previousBin === undefined) delete process.env.AUTORE_BIN;
      else process.env.AUTORE_BIN = previousBin;
      if (previousWorkspace === undefined) delete process.env.AUTORE_WORKSPACE;
      else process.env.AUTORE_WORKSPACE = previousWorkspace;
    }
  });

  it("memakai cache lima detik supaya polling berulang tidak membebani proses autore", async () => {
    const { loadDashboardStatus, resetStatusCache } = await freshStatus();
    resetStatusCache();
    const runner = vi.fn(async () => JSON.stringify(fixture));
    let sekarang = 1_000;

    await loadDashboardStatus(runner, () => sekarang);
    sekarang += 4_999;
    const kedua = await loadDashboardStatus(runner, () => sekarang);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(kedua).toEqual({ data: fixture, stale: false });

    sekarang += 1;
    await loadDashboardStatus(runner, () => sekarang);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("never runs a shell, so AUTORE_BIN metacharacters cannot execute commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autore-api-"));
    const marker = join(dir, "pwned");
    const previousBin = process.env.AUTORE_BIN;
    process.env.AUTORE_BIN = `${join(dir, "autore")}; touch ${marker}`;
    try {
      const { runAutore } = await freshStatus();
      await expect(runAutore()).rejects.toThrow();
      await expect(readFile(marker)).rejects.toThrow();
    } finally {
      if (previousBin === undefined) delete process.env.AUTORE_BIN;
      else process.env.AUTORE_BIN = previousBin;
    }
  });
});
