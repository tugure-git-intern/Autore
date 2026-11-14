import { describe, expect, it, vi } from "vitest";
import { createApp } from "./index";
import { loadReleases, type ReleaseLoader } from "./releases";

const COMMIT = "a".repeat(40);
const DIGEST = "sha256:" + "1".repeat(64);

const EVENTS = {
  version: 1,
  events: [
    {
      id: "req-1",
      ts: "2026-11-13T04:00:00Z",
      kind: "requested",
      app: "tes-testing",
      environment: "staging",
      request_id: "req-1",
      commit: COMMIT,
      build_number: 1,
      actor: "operator",
    },
    {
      id: "deploy-1",
      ts: "2026-11-13T04:01:00Z",
      kind: "deploy_result",
      app: "tes-testing",
      environment: "staging",
      request_id: "req-1",
      commit: COMMIT,
      build_number: 1,
      digest: DIGEST,
      deployment_id: "dep-1",
      outcome: "success",
      active_before: null,
      active_after: { deployment_id: "dep-1", digest: DIGEST },
      health: "ok",
    },
  ],
};

function appDengan(loader: ReleaseLoader) {
  return createApp(
    async () => "{}",
    {} as never,
    undefined,
    {},
    undefined,
    undefined,
    () => 0,
    async () => [],
    loader,
  );
}

describe("GET /api/releases", () => {
  it("membaca event dan mengembalikan fold staging tanpa menulis apa pun", async () => {
    const run = vi.fn(async () => JSON.stringify(EVENTS));
    const hasil = await loadReleases("tes-testing", run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(hasil.data.environments.find((env) => env.nama === "staging")?.active_deployment_id).toBe("dep-1");
    expect(hasil.data.releases[0]?.status).toBe("menunggu_persetujuan");
  });

  it("mengembalikan 400 tanpa app dan 502 saat CLI gagal", async () => {
    const app = appDengan(async () => {
      throw new Error("gagal");
    });
    expect((await app.request("http://localhost/api/releases")).status).toBe(400);
    expect((await app.request("http://localhost/api/releases?app=tes-testing")).status).toBe(502);
  });

  it("tidak menyediakan endpoint POST release", async () => {
    const app = appDengan(async () => ({
      data: { releases: [], deployments: [], environments: [], diabaikan: [] },
      stale: false,
    }));
    const response = await app.request("http://localhost/api/releases", { method: "POST" });
    expect(response.status).toBe(404);
  });
});
