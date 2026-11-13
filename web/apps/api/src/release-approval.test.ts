import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReleaseEvent } from "@autore/contracts";
import { ambilKunci, lepasSemuaKunci } from "./kunci";
import { hatchApprovals, jalurLedger } from "./release-approval";
import type { Identitas } from "./session";

const COMMIT = "a".repeat(40);
const APP = "tes-testing";
const ID = `${APP}:${COMMIT}:1`;
const DIGEST = "sha256:" + "1".repeat(64);

/** Identitas approver; nama/email tidak dipakai approval, login-lah yang dicatat. */
const orang = (login: string): Identitas => ({ login, nama: login, email: `${login}@contoh.test` });

/** Ledger di temp dir: tes tidak boleh menyentuh state produksi (~/.autore). */
function ledgerTemp(events: ReleaseEvent[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "autore-approval-"));
  const berkas = join(dir, "release-state.json");
  writeFileSync(berkas, JSON.stringify({ version: 1, events }, null, 2), "utf8");
  return berkas;
}

/** Event dasar; `build` memisahkan release dalam satu aplikasi. */
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
function menungguPersetujuan(build = 1, dibuatOleh = "operator"): ReleaseEvent[] {
  return [
    ev({ id: `req-${build}`, kind: "requested", build_number: build, actor: dibuatOleh }),
    ev({ id: `build-${build}`, kind: "build_started", build_number: build, actor: dibuatOleh }),
    ev({
      id: `digest-${build}`,
      kind: "digest_verified",
      digest: DIGEST,
      build_number: build,
      actor: dibuatOleh,
    }),
    ev({
      id: `deploy-stg-${build}`,
      kind: "deploy_result",
      digest: DIGEST,
      deployment_id: `dep-stg-${build}`,
      outcome: "success",
      active_before: null,
      active_after: { deployment_id: `dep-stg-${build}`, digest: DIGEST },
      build_number: build,
      actor: dibuatOleh,
    }),
  ];
}

/** Rantai yang berhenti di staging_berjalan: approval belum sah. */
function stagingBerjalan(): ReleaseEvent[] {
  return [
    ev({ id: "req-1", kind: "requested" }),
    ev({ id: "build-1", kind: "build_started" }),
    ev({ id: "digest-1", kind: "digest_verified", digest: DIGEST }),
  ];
}

/** Isi ledger setelah handler jalan; dibaca dari berkas, bukan dari hasil handler. */
function eventsDi(berkas: string): ReleaseEvent[] {
  return (JSON.parse(readFileSync(berkas, "utf8")) as { events: ReleaseEvent[] }).events;
}

describe("jalurLedger", () => {
  it("memakai AUTORE_WORKSPACE bila di-set (workspace yang sama dengan CLI)", () => {
    expect(jalurLedger({ AUTORE_WORKSPACE: "/srv/ws", HOME: "/home/u" } as NodeJS.ProcessEnv)).toBe(
      "/srv/ws/release-state.json",
    );
  });

  it("jatuh ke ~/autore-workspace bila env kosong, tanpa bergantung cwd", () => {
    expect(jalurLedger({ HOME: "/home/u" } as NodeJS.ProcessEnv)).toBe(
      "/home/u/autore-workspace/release-state.json",
    );
    expect(jalurLedger({ AUTORE_WORKSPACE: "   ", HOME: "/home/u" } as NodeJS.ProcessEnv)).toBe(
      "/home/u/autore-workspace/release-state.json",
    );
  });
});

describe("approve", () => {
  it("menyetujui release dan menulis satu event approved ke ledger yang sama", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const hasil = await hatchApprovals({ ledger: () => berkas, clock: () => "2026-11-13T05:00:00Z" })
      .approve(ID, orang("budi"));

    expect(hasil.ok && hasil.release.status).toBe("disetujui");
    expect(hasil.ok && hasil.release.approved_by).toBe("budi");
    const events = eventsDi(berkas);
    expect(events).toHaveLength(5);
    expect(events[4]).toMatchObject({
      id: `${APP}-1-approved`,
      kind: "approved",
      app: APP,
      environment: "staging",
      request_id: "web-budi",
      commit: COMMIT,
      build_number: 1,
      actor: "budi",
      ts: "2026-11-13T05:00:00Z",
    });
  });

  it("idempoten: approve kedua tidak menulis event kedua dan tidak mengubah approved_by", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const handler = hatchApprovals({ ledger: () => berkas });
    await handler.approve(ID, orang("budi"));
    const ulang = await handler.approve(ID, orang("siti"));

    expect(ulang.ok && ulang.release.approved_by).toBe("budi");
    expect(eventsDi(berkas).filter((event) => event.kind === "approved")).toHaveLength(1);
  });

  it("409 bila status bukan menunggu_persetujuan", async () => {
    const berkas = ledgerTemp(stagingBerjalan());
    const hasil = await hatchApprovals({ ledger: () => berkas }).approve(ID, orang("budi"));

    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.status).toBe(409);
    expect(eventsDi(berkas)).toHaveLength(3);
  });

  it("404 bila release tidak ada di ledger", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const hasil = await hatchApprovals({ ledger: () => berkas }).approve(
      `${APP}:${COMMIT}:9`,
      orang("budi"),
    );
    expect(hasil.ok === false && hasil.status).toBe(404);
  });

  it("404 bila id release tidak berisi id aplikasi", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const hasil = await hatchApprovals({ ledger: () => berkas }).approve("commit:1", orang("budi"));
    expect(hasil.ok === false && hasil.status).toBe(404);
  });

  it("approve oleh pembuat commit tetap diproses dan tercatat (kontrol self-approval ditidakkan)", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1, "operator"));
    const hasil = await hatchApprovals({ ledger: () => berkas }).approve(ID, orang("  Operator  "));

    expect(hasil.ok && hasil.release.status).toBe("disetujui");
    expect(hasil.ok && hasil.release.approved_by).toBe("Operator");
    expect(eventsDi(berkas)).toHaveLength(5);
  });

  it("keputusan status yang salah tetap 409 (bukan 403) lewat handler", async () => {
    const berkas = ledgerTemp(menungguPersetujuan(1, "operator"));
    const handler = hatchApprovals({ ledger: () => berkas });
    await handler.reject(ID, orang("budi"), "Regresi klaim.");
    const hasil = await handler.approve(ID, orang("budi"));

    expect(hasil.ok === false && hasil.status).toBe(409);
  });

  it("409 saat kunci aplikasi masih dipegang aksi lain", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const lepas = ambilKunci(APP, "deploy");
    const hasil = await hatchApprovals({ ledger: () => berkas }).approve(ID, orang("budi"));
    lepas?.();
    lepasSemuaKunci();

    expect(hasil.ok === false && hasil.status).toBe(409);
    expect(eventsDi(berkas)).toHaveLength(4);
  });

  it("dua approve bersamaan hanya menghasilkan satu event (idempotensi + kunci)", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const handler = hatchApprovals({ ledger: () => berkas });
    const hasil = await Promise.all([
      handler.approve(ID, orang("budi")),
      handler.approve(ID, orang("siti")),
    ]);

    expect(hasil.every((satu) => satu.ok)).toBe(true);
    expect(eventsDi(berkas).filter((event) => event.kind === "approved")).toHaveLength(1);
  });

  it("memangkas ledger ke 500 event seperti CLI Rust", async () => {
    const isi = [
      ...Array.from({ length: 496 }, (_, i) => ev({ id: `isi-${i}`, kind: "requested" })),
      ...menungguPersetujuan(),
    ];
    const berkas = ledgerTemp(isi);
    expect(eventsDi(berkas)).toHaveLength(500);

    const hasil = await hatchApprovals({ ledger: () => berkas }).approve(ID, orang("budi"));
    const events = eventsDi(berkas);
    expect(hasil.ok).toBe(true);
    expect(events).toHaveLength(500);
    expect(events[0].id).toBe("isi-1");
    expect(events[499]).toMatchObject({ id: `${APP}-1-approved`, kind: "approved" });
  });
});

describe("reject", () => {
  it("400 bila alasan kosong atau hanya spasi, tanpa menulis event", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const handler = hatchApprovals({ ledger: () => berkas });

    expect((await handler.reject(ID, orang("budi"), "")).ok).toBe(false);
    expect((await handler.reject(ID, orang("budi"), "   ")).ok).toBe(false);
    expect(eventsDi(berkas)).toHaveLength(4);
  });

  it("reject sah membuat release ditolak dan alasannya tercatat sebagai error event", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const hasil = await hatchApprovals({ ledger: () => berkas }).reject(
      ID,
      orang("budi"),
      "  Regresi pembayaran klaim.  ",
    );

    expect(hasil.ok && hasil.release.status).toBe("ditolak");
    expect(hasil.ok && hasil.release.alasan).toBe("Regresi pembayaran klaim.");
    expect(eventsDi(berkas)[4]).toMatchObject({
      id: `${APP}-1-rejected`,
      kind: "rejected",
      actor: "budi",
      error: "Regresi pembayaran klaim.",
    });
  });

  it("409 bila release sudah disetujui (tidak ada jalan disetujui -> ditolak)", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const handler = hatchApprovals({ ledger: () => berkas });
    await handler.approve(ID, orang("budi"));
    const hasil = await handler.reject(ID, orang("siti"), "berubah pikiran");

    expect(hasil.ok === false && hasil.status).toBe(409);
    expect(eventsDi(berkas)).toHaveLength(5);
  });

  it("404 bila release tidak ada", async () => {
    const berkas = ledgerTemp(menungguPersetujuan());
    const hasil = await hatchApprovals({ ledger: () => berkas }).reject(
      `${APP}:${COMMIT}:7`,
      orang("budi"),
      "tidak ada",
    );
    expect(hasil.ok === false && hasil.status).toBe(404);
  });
});

describe("ledger rusak", () => {
  it("berkas rusak diperlakukan sebagai ledger kosong: release tidak ditemukan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autore-approval-"));
    const berkas = join(dir, "release-state.json");
    writeFileSync(berkas, "{bukan json", "utf8");
    const hasil = await hatchApprovals({ ledger: () => berkas }).approve(ID, orang("budi"));
    expect(hasil.ok === false && hasil.status).toBe(404);
  });

  it("berkas belum ada tidak dibuat saat release tidak ditemukan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autore-approval-"));
    const berkas = join(dir, "release-state.json");
    const hasil = await hatchApprovals({ ledger: () => berkas }).approve(ID, orang("budi"));
    expect(hasil.ok === false && hasil.status).toBe(404);
  });
});
