import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  foldReleaseEvents,
  isReleaseEvent,
  type FoldResult,
  type Release,
  type ReleaseEvent,
} from "@autore/contracts";
import { ambilKunci, pemegangKunci } from "./kunci";
import type { Identitas } from "./session";

/** Batas event sama dengan CLI Rust (`release.rs`): yang lama dipangkas dari depan. */
const MAX_EVENTS = 500;

/**
 * Path ledger = workspace yang sama dengan CLI (`workspace.rs`:
 * `AUTORE_WORKSPACE`, atau `~/autore-workspace`). `autore release status --json`
 * — yang jadi sumber GET /api/releases — membaca berkas ini, jadi keputusan
 * approval harus mendarat di berkas yang sama; kalau tidak, keputusan akan
 * terlihat di dashboard tapi hilang di pipeline.
 *
 * Dibaca tiap panggilan, bukan sekali saat import: unit bisa pindah workspace
 * tanpa restart dan tes bisa mengarahkannya ke direktori sementara.
 */
export function jalurLedger(env: NodeJS.ProcessEnv = process.env): string {
  const workspace = (env.AUTORE_WORKSPACE ?? "").trim();
  return join(workspace || join(env.HOME || homedir(), "autore-workspace"), "release-state.json");
}

export type HasilKeputusan =
  | { ok: true; status: 200; release: Release }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export type ApprovalHandler = {
  approve(id: string, actor: Identitas): Promise<HasilKeputusan>;
  reject(id: string, actor: Identitas, alasan: string): Promise<HasilKeputusan>;
};

type Ledger = { version: 1; events: unknown[] };

/**
 * Ledger mentah. Berkas hilang/rusak/versi lain dibaca sebagai KOSONG: tanpa
 * event, release tidak ditemukan dan keputusannya ditolak — tidak ada yang
 * ditulis ke berkas yang tidak kita pahami, apalagi ke path tebakan.
 */
function bacaLedgerMentah(jalur: string): Ledger {
  try {
    const record = JSON.parse(readFileSync(jalur, "utf8")) as { version?: unknown; events?: unknown };
    if (record.version === 1 && Array.isArray(record.events)) {
      return { version: 1, events: record.events };
    }
  } catch {
    // Belum ada berkas / JSON rusak: diperlakukan sebagai ledger kosong.
  }
  return { version: 1, events: [] };
}

/** Id release = `<app>:<commit>:<build>`; yang dibutuhkan kunci hanya bagian app. */
function appDariId(id: string): string | null {
  const pisah = id.indexOf(":");
  const app = pisah === -1 ? "" : id.slice(0, pisah).trim();
  return app ? app : null;
}

/** Env `AUTORE_ALLOW_SELF_APPROVAL` = 1/true melonggarkan larangan self-approval;
 *  jejaknya tetap wajib terbawa di event (`self_approval: true`). */
function bacaSelfApproval(): boolean {
  const nilai = (process.env.AUTORE_ALLOW_SELF_APPROVAL ?? "").trim().toLowerCase();
  return nilai === "1" || nilai === "true";
}

function bangunEvent(input: {
  kind: "approved" | "rejected";
  release: Release;
  build: number;
  actor: string;
  ts: string;
  alasan?: string;
  selfApproval: boolean;
}): ReleaseEvent {
  const { kind, release, build, actor, ts } = input;
  const dasar = {
    id: `${release.application_id}-${build}-${kind}`,
    ts,
    kind,
    app: release.application_id,
    // Keputusan diambil pada tahap staging: produksi baru dibuka setelah disetujui.
    environment: "staging" as const,
    request_id: `web-${actor}`,
    commit: release.commit_sha,
    build_number: build,
    actor,
  };
  if (kind === "rejected") return { ...dasar, error: (input.alasan ?? "").trim() };
  return input.selfApproval ? { ...dasar, self_approval: true } : dasar;
}

/** Pesan fold kontrak → kode HTTP: self-approval 403, sisanya soal status = 409. */
function terjemah(error: unknown): HasilKeputusan {
  const pesan = error instanceof Error ? error.message : String(error);
  const self = pesan.includes("pembuat release");
  return {
    ok: false,
    status: self ? 403 : 409,
    error: self
      ? "approve oleh pembuat commit itu sendiri ditolak; set AUTORE_ALLOW_SELF_APPROVAL=1 bila memang disengaja"
      : `status release tidak mengizinkan keputusan ini: ${pesan}`,
  };
}

/**
 * Tulis atomik (tmp lalu rename) di dalam kunci aplikasi, idempoten per id event,
 * dan dipangkas pada 500 event seperti CLI Rust.
 *
 * Batas serialisasi: kunci di `kunci.ts` hanya berlaku DI DALAM proses API ini.
 * CLI Rust menulis ledger yang sama saat pipeline jalan dan memakai lock berkas
 * sendiri (`release-state.append.lock`); race lintas proses bisa terjadi dan itu
 * DITERIMA — keputusan approval diambil di luar jendela build, dan penulisan
 * atomik membuat berkas hasilnya tetap utuh (bukan setengah tertulis).
 */
function tulisEvent(jalur: string, event: ReleaseEvent): void {
  const mentah = bacaLedgerMentah(jalur);
  // Idempoten berdasarkan id event: approve/reject yang id-nya sudah ada tidak
  // menulis event kedua, karena event ganda merusak jejak keputusan.
  if (mentah.events.some((item) => (item as { id?: unknown }).id === event.id)) return;
  const semua = [...mentah.events, event];
  const dipangkas = semua.length > MAX_EVENTS ? semua.slice(semua.length - MAX_EVENTS) : semua;
  mkdirSync(dirname(jalur), { recursive: true });
  // Nama tmp sama polanya dengan CLI (`<EVENTS>.tmp-<pid>`) supaya dua penulis
  // tidak pernah memakai berkas sementara yang sama.
  const tmp = `${jalur}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify({ version: 1, events: dipangkas }, null, 2)}
`, "utf8");
  renameSync(tmp, jalur);
}

export type ApprovalDeps = {
  /** Path ledger; default `jalurLedger()`. */
  ledger?: () => string;
  clock?: () => string;
  allowSelfApproval?: () => boolean;
};

/**
 * Approval release: `POST /api/releases/:id/{approve,reject}`. Handler ini tidak
 * menyentuh HTTP — gerbang role ada di middleware, jadi keputusan di sini hanya
 * soal status release, self-approval, dan kunci aplikasi.
 */
export function hatchApprovals(deps: ApprovalDeps = {}): ApprovalHandler {
  const jalur = deps.ledger ?? (() => jalurLedger());
  const jam = deps.clock ?? (() => new Date().toISOString());
  const bolehSendiri = deps.allowSelfApproval ?? bacaSelfApproval;

  async function keputusan(
    kind: "approved" | "rejected",
    id: string,
    actor: Identitas,
    alasan?: string,
  ): Promise<HasilKeputusan> {
    const dipangkasId = id.trim();
    const app = appDariId(dipangkasId);
    if (!app) return { ok: false, status: 404, error: `release "${id}" tidak dikenal` };
    if (kind === "rejected" && !(alasan ?? "").trim()) {
      return { ok: false, status: 400, error: "alasan penolakan wajib diisi" };
    }

    // Kunci aplikasi yang sama dengan deploy/scan/quick-start: keputusan tidak
    // boleh menulis ledger aplikasi yang sedang dibangun pipeline.
    const lepas = ambilKunci(app, "approval");
    if (!lepas) {
      return {
        ok: false,
        status: 409,
        error: `aksi ${pemegangKunci(app) ?? "approval"} masih berjalan, tunggu sampai selesai`,
      };
    }
    try {
      const berkas = jalur();
      const relevan = bacaLedgerMentah(berkas).events
        .filter(isReleaseEvent)
        .filter((event) => event.app === app);

      let sebelum: FoldResult;
      try {
        sebelum = foldReleaseEvents(relevan);
      } catch {
        // Ledger aplikasi ini sudah tidak konsisten sebelum kita menulis: keputusan
        // apa pun hanya menambah kekacauan, jadi ditolak.
        return { ok: false, status: 409, error: `ledger release ${app} tidak konsisten` };
      }
      const release = sebelum.releases.find((item) => item.id === dipangkasId);
      if (!release) return { ok: false, status: 404, error: `release "${dipangkasId}" tidak ada` };

      const build = Number(release.id.slice(release.id.lastIndexOf(":") + 1));
      if (!Number.isInteger(build)) {
        return { ok: false, status: 409, error: `id release "${release.id}" tanpa nomor build` };
      }

      // Idempoten: approve ulang pada release yang sudah disetujui tidak mengubah
      // apa pun (termasuk approved_by) dan tidak menulis event kedua.
      if (kind === "approved" && release.status === "disetujui") {
        return { ok: true, status: 200, release };
      }

      const sama =
        release.dibuat_oleh.trim().toLowerCase() === actor.login.trim().toLowerCase();
      const event = bangunEvent({
        kind,
        release,
        build,
        actor: actor.login,
        ts: jam(),
        alasan,
        selfApproval: kind === "approved" && sama && bolehSendiri(),
      });

      let sesudah: FoldResult;
      try {
        sesudah = foldReleaseEvents([...relevan, event]);
      } catch (error) {
        // Fold adalah validatornya: self-approval dan status yang salah ditolak di
        // sana, jadi tidak ada jalur yang bisa menulis event tidak sah.
        return terjemah(error);
      }

      tulisEvent(berkas, event);
      return {
        ok: true,
        status: 200,
        release: sesudah.releases.find((item) => item.id === release.id) ?? release,
      };
    } finally {
      lepas();
    }
  }

  return {
    approve: (id, actor) => keputusan("approved", id, actor),
    reject: (id, actor, alasan) => keputusan("rejected", id, actor, alasan),
  };
}
