import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReleaseEvent } from "@autore/contracts";
import { lepasSemuaKunci } from "./kunci";
import { bacaEnvironmentRollback, hatchRollback, pilihTargetRollback } from "./release-rollback";
import type { Identitas } from "./session";

const COMMIT = "a".repeat(40);
const APP = "tes-testing";
const DIGEST_1 = "sha256:" + "1".repeat(64);
const DIGEST_2 = "sha256:" + "2".repeat(64);
const orang = (login: string): Identitas => ({ login, nama: login, email: `${login}@contoh.test` });

/** Ledger di temp dir: tes tidak boleh menyentuh state produksi (~/.autore). */
function ledgerTemp(events: ReleaseEvent[]): string {
  const dir = mkdtempSync(join(tmpdir(), "autore-rollback-"));
  const berkas = join(dir, "release-state.json");
  writeFileSync(berkas, JSON.stringify({ version: 1, events }, null, 2), "utf8");
  return berkas;
}

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

/** Rantai lengkap satu release; `dipromosikan` menambahkan approval + production sehat. */
function release(build: number, digest: string, dipromosikan = false): ReleaseEvent[] {
  const dasar = [
    ev({ id: `req-${build}`, kind: "requested", build_number: build }),
    ev({ id: `build-${build}`, kind: "build_started", build_number: build }),
    ev({ id: `digest-${build}`, kind: "digest_verified", digest, build_number: build }),
    ev({
      id: `deploy-stg-${build}`,
      kind: "deploy_result",
      digest,
      deployment_id: `dep-stg-${build}`,
      outcome: "success",
      active_before: null,
      active_after: { deployment_id: `dep-stg-${build}`, digest },
      build_number: build,
    }),
  ];
  if (!dipromosikan) return dasar;
  return [
    ...dasar,
    ev({ id: `approve-${build}`, kind: "approved", build_number: build, actor: "budi" }),
    ev({
      id: `deploy-prod-${build}`,
      kind: "deploy_result",
      environment: "production",
      digest,
      deployment_id: `dep-prod-${build}`,
      outcome: "success",
      active_before: null,
      active_after: { deployment_id: `dep-prod-${build}`, digest },
      build_number: build,
      health: "ok",
    }),
  ];
}

/** Dua release; build 2 aktif di staging+production, build 1 tinggal jejaknya. */
function duaRelease(): ReleaseEvent[] {
  return [...release(1, DIGEST_1, true), ...release(2, DIGEST_2, true)];
}

type Panggilan = { bin: string; args: string[] };

function handler(events: ReleaseEvent[], panggilan: Panggilan[] = [], code = 0) {
  const berkas = ledgerTemp(events);
  return {
    berkas,
    panggilan,
    hatch: hatchRollback({
      ledger: berkas,
      bin: "autore",
      spawn: async (bin, args) => {
        panggilan.push({ bin, args });
        return { code, stderr: code === 0 ? "" : "boom" };
      },
    }),
  };
}

describe("environment rollback eksplisit (T1)", () => {
  it("R31 body tanpa environment ditolak, tanpa default", () => {
    expect(bacaEnvironmentRollback({})).toEqual({
      ok: false,
      error: 'body hanya boleh memuat kunci environment. body wajib JSON {"environment":"staging"|"production"}',
    });
    expect(bacaEnvironmentRollback(undefined).ok).toBe(false);
    expect(bacaEnvironmentRollback(null).ok).toBe(false);
  });

  it("R32 environment asing, kapital beda, dan nilai kosong ditolak", () => {
    for (const nilai of ["Production", "STAGING", "prod", "p", "", " ", 1, true, null]) {
      expect(bacaEnvironmentRollback({ environment: nilai }).ok).toBe(false);
    }
    expect(bacaEnvironmentRollback({ environment: "production", app: APP }).ok).toBe(false);
    expect(bacaEnvironmentRollback({ environment: "staging" })).toEqual({
      ok: true,
      environment: "staging",
    });
    expect(bacaEnvironmentRollback({ environment: "production" })).toEqual({
      ok: true,
      environment: "production",
    });
  });
});

describe("target rollback", () => {
  it("R33 memilih deployment sehat TERAKHIR yang bukan aktif dan bukan release sendiri", () => {
    const lingkungan = {
      id: `${APP}:staging`,
      application_id: APP,
      nama: "staging" as const,
      target: `${APP}-staging`,
      status_konfigurasi: "terkonfigurasi" as const,
      active_deployment_id: "dep-stg-2",
    };
    const dasar = {
      environment_id: lingkungan.id,
      health_check_url: "",
      selesai_pada: null,
      error: null,
    };
    const dipilih = pilihTargetRollback(
      [
        { ...dasar, id: "dep-stg-2", release_id: `${APP}:${COMMIT}:2`, image_digest: DIGEST_2, status: "sehat", mulai_pada: "2026-11-13T05:00:00Z" },
        { ...dasar, id: "dep-stg-1", release_id: `${APP}:${COMMIT}:1`, image_digest: DIGEST_1, status: "sehat", mulai_pada: "2026-11-13T04:00:00Z" },
        { ...dasar, id: "dep-stg-lama", release_id: `${APP}:${COMMIT}:0`, image_digest: DIGEST_1, status: "gagal", mulai_pada: "2026-11-13T03:00:00Z" },
        { ...dasar, id: "dep-stg-2b", release_id: `${APP}:${COMMIT}:2`, image_digest: DIGEST_2, status: "sehat", mulai_pada: "2026-11-13T05:30:00Z" },
      ],
      lingkungan,
      { id: `${APP}:${COMMIT}:2` } as never,
    );
    expect(dipilih?.id).toBe("dep-stg-1");
  });
});

describe("handler rollback", () => {
  it("R34 menolak release yang tidak ada (404)", async () => {
    const h = handler(duaRelease());
    try {
      const hasil = await h.hatch.rollback(`${APP}:${COMMIT}:9`, "staging", orang("budi"));
      expect(hasil).toMatchObject({ ok: false, status: 404 });
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R35 menolak rollback tanpa deployment sehat sebelumnya (409)", async () => {
    const h = handler(release(1, DIGEST_1, false));
    try {
      const hasil = await h.hatch.rollback(`${APP}:${COMMIT}:1`, "staging", orang("budi"));
      expect(hasil).toMatchObject({ ok: false, status: 409 });
      expect(h.panggilan).toHaveLength(0);
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R36 rollback staging dari release aktif memicu job dengan ROLLBACK target lama", async () => {
    const h = handler(duaRelease());
    try {
      const hasil = await h.hatch.rollback(`${APP}:${COMMIT}:2`, "staging", orang("budi"));
      expect(hasil).toMatchObject({
        ok: true,
        status: 202,
        job: `${APP}-rollback`,
        environment: "staging",
        target_deployment_id: "dep-stg-1",
        target_digest: DIGEST_1,
      });
      expect(h.panggilan).toHaveLength(1);
      expect(h.panggilan[0].args).toEqual([
        "release",
        "trigger-rollback",
        "--job",
        `${APP}-rollback`,
        "--app",
        APP,
        "--environment",
        "staging",
        "--digest",
        DIGEST_1,
        "--deployment-id",
        "dep-stg-1",
        "--release-id",
        `${APP}:${COMMIT}:2`,
        "--build",
        "2",
        "--actor",
        "budi",
      ]);
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R37 rollback production dari release aktif memicu job environment production", async () => {
    const h = handler(duaRelease());
    try {
      const hasil = await h.hatch.rollback(`${APP}:${COMMIT}:2`, "production", orang("budi"));
      expect(hasil).toMatchObject({
        ok: true,
        environment: "production",
        target_deployment_id: "dep-prod-1",
        target_digest: DIGEST_1,
      });
      expect(h.panggilan[0].args).toContain("production");
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R38 kegagalan CLI jadi 502 dan tidak ada klaim sukses", async () => {
    const h = handler(duaRelease(), [], 1);
    try {
      const hasil = await h.hatch.rollback(`${APP}:${COMMIT}:2`, "staging", orang("budi"));
      expect(hasil).toMatchObject({ ok: false, status: 502 });
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R39 rollback kedua saat kunci aplikasi masih dipegang ditolak (409)", async () => {
    const h = handler(duaRelease());
    const tahan = handler(duaRelease());
    try {
      const pertama = h.hatch.rollback(`${APP}:${COMMIT}:2`, "staging", orang("budi"));
      const kedua = await tahan.hatch.rollback(`${APP}:${COMMIT}:2`, "staging", orang("budi"));
      expect(kedua).toMatchObject({ ok: false, status: 409 });
      await pertama;
    } finally {
      lepasSemuaKunci();
    }
  });
});
