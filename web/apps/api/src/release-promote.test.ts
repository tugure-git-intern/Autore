import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReleaseEvent } from "@autore/contracts";
import { lepasSemuaKunci } from "./kunci";
import { hatchPromote } from "./release-promote";
import type { Identitas } from "./session";

const COMMIT = "a".repeat(40);
const APP = "tes-testing";
const DIGEST_1 = "sha256:" + "1".repeat(64);
const DIGEST_2 = "sha256:" + "2".repeat(64);
const orang = (login: string): Identitas => ({ login, nama: login, email: `${login}@contoh.test` });

/** Ledger di temp dir: tes tidak boleh menyentuh state produksi (~/.autore). */
function ledgerTemp(events: ReleaseEvent[]): string {
  const dir = mkdtempSync(join(tmpdir(), "autore-promote-"));
  const berkas = join(dir, "release-state.json");
  writeFileSync(berkas, JSON.stringify({ version: 1, events }, null, 2), "utf8");
  return berkas;
}

function ev(overrides: Partial<ReleaseEvent> = {}): ReleaseEvent {
  return {
    id: "evt-1",
    ts: "2026-11-14T04:00:00Z",
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

function dasar(build: number, digest: string): ReleaseEvent[] {
  return [
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
}

/** Release lolos staging (staging_sehat), belum di-approve. */
function menunggu(build: number, digest: string): ReleaseEvent[] {
  return dasar(build, digest);
}

function disetujui(build: number, digest: string): ReleaseEvent[] {
  return [...dasar(build, digest), ev({ id: `approve-${build}`, kind: "approved", build_number: build, actor: "budi" })];
}

type Panggilan = { bin: string; args: string[] };

function handler(events: ReleaseEvent[], panggilan: Panggilan[] = [], code = 0) {
  const berkas = ledgerTemp(events);
  return {
    berkas,
    panggilan,
    hatch: hatchPromote({
      ledger: berkas,
      bin: "autore",
      spawn: async (bin, args) => {
        panggilan.push({ bin, args });
        return { code, stderr: code === 0 ? "" : "boom" };
      },
    }),
  };
}

describe("handler promosi production", () => {
  it("R40 menolak release yang tidak ada (404)", async () => {
    const h = handler(disetujui(1, DIGEST_1));
    try {
      const hasil = await h.hatch.promote(`${APP}:${COMMIT}:9`, orang("budi"));
      expect(hasil).toMatchObject({ ok: false, status: 404 });
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R41 menolak release yang belum disetujui (409) tanpa memicu job", async () => {
    const h = handler(menunggu(1, DIGEST_1));
    try {
      const hasil = await h.hatch.promote(`${APP}:${COMMIT}:1`, orang("budi"));
      expect(hasil).toMatchObject({ ok: false, status: 409 });
      expect(h.panggilan).toHaveLength(0);
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R42 release disetujui memicu job promosi dengan digest staging aktif", async () => {
    const h = handler(disetujui(1, DIGEST_1));
    try {
      const hasil = await h.hatch.promote(`${APP}:${COMMIT}:1`, orang("budi"));
      expect(hasil).toMatchObject({
        ok: true,
        status: 202,
        job: `${APP}-promote`,
        environment: "production",
        release_id: `${APP}:${COMMIT}:1`,
        digest: DIGEST_1,
      });
      expect(h.panggilan).toHaveLength(1);
      expect(h.panggilan[0].args).toEqual([
        "release",
        "trigger-promote",
        "--job",
        `${APP}-promote`,
        "--app",
        APP,
        "--digest",
        DIGEST_1,
        "--release-id",
        `${APP}:${COMMIT}:1`,
        "--build",
        "1",
        "--actor",
        "budi",
        "--container-port",
        "8080",
        "--deploy-port",
        "8154",
      ]);
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R43 menolak bila staging aktif sudah bukan digest release (409)", async () => {
    const h = handler([
      ...disetujui(1, DIGEST_2),
      ...dasar(2, DIGEST_1),
    ]);
    try {
      const hasil = await h.hatch.promote(`${APP}:${COMMIT}:1`, orang("budi"));
      expect(hasil).toMatchObject({ ok: false, status: 409 });
      expect(h.panggilan).toHaveLength(0);
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R44 menolak promosi bila production sudah memakai digest yang sama (409)", async () => {
    const produksi: ReleaseEvent[] = [
      ...disetujui(1, DIGEST_2),
      ev({
        id: "deploy-prod-1",
        kind: "deploy_result",
        environment: "production",
        digest: DIGEST_2,
        deployment_id: "dep-prod-1",
        outcome: "success",
        active_before: null,
        active_after: { deployment_id: "dep-prod-1", digest: DIGEST_2 },
        build_number: 1,
        health: "ok",
      }),
    ];
    const h = handler([...produksi, ...disetujui(2, DIGEST_2)]);
    try {
      const hasil = await h.hatch.promote(`${APP}:${COMMIT}:2`, orang("budi"));
      expect(hasil).toMatchObject({ ok: false, status: 409 });
      expect(h.panggilan).toHaveLength(0);
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R45 kegagalan CLI jadi 502 dan tidak ada klaim sukses", async () => {
    const h = handler(disetujui(1, DIGEST_1), [], 1);
    try {
      const hasil = await h.hatch.promote(`${APP}:${COMMIT}:1`, orang("budi"));
      expect(hasil).toMatchObject({ ok: false, status: 502 });
    } finally {
      lepasSemuaKunci();
    }
  });

  it("R46 promosi kedua saat kunci aplikasi masih dipegang ditolak (409)", async () => {
    const h = handler(disetujui(1, DIGEST_1));
    const tahan = handler(disetujui(1, DIGEST_1));
    try {
      const pertama = h.hatch.promote(`${APP}:${COMMIT}:1`, orang("budi"));
      const kedua = await tahan.hatch.promote(`${APP}:${COMMIT}:1`, orang("budi"));
      expect(kedua).toMatchObject({ ok: false, status: 409 });
      await pertama;
    } finally {
      lepasSemuaKunci();
    }
  });
});
