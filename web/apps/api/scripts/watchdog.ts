/**
 * Watchdog production: probe `health_check_url` deployment aktif, lalu putuskan
 * rollback setelah N gagal beruntun. Default `dry-run` — hanya menulis keputusan
 * ke stdout/jurnal; eksekusi butuh AUTORE_WATCHDOG_MODE=on.
 *
 * Dijalankan timer systemd tiap menit:
 *   AUTORE_WATCHDOG_APP=autore-dummy node_modules/.bin/tsx apps/api/scripts/watchdog.ts
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { foldReleaseEvents, isReleaseEvent } from "@autore/contracts";
import { bacaLedgerMentah } from "../src/release-approval";
import { jalurLedger } from "../src/release-approval";
import { bacaLingkungan } from "../src/lingkungan";
import { hatchRollback, pilihTargetRollback } from "../src/release-rollback";
import { putuskanWatchdog, type StatusWatchdog } from "../src/release-watchdog";
import type { Identitas } from "../src/session";

const APP = process.env.AUTORE_WATCHDOG_APP ?? "";
if (!APP) {
  console.error("AUTORE_WATCHDOG_APP wajib diisi");
  process.exit(2);
}
const MODE = process.env.AUTORE_WATCHDOG_MODE === "on" ? "on" : "dry-run";
const AMBANG = Number(process.env.AUTORE_WATCHDOG_AMBANG ?? 3);
const TIMEOUT_MS = Number(process.env.AUTORE_WATCHDOG_TIMEOUT_MS ?? 5000);
const WATCHDOG: Identitas = {
  login: "watchdog",
  nama: "Autore Watchdog",
  email: "watchdog@autore.local",
};

function catat(baris: Record<string, unknown>): void {
  console.log(JSON.stringify({ app: APP, mode: MODE, ...baris }));
}

function statusPath(ledger: string): string {
  return join(dirname(ledger), `watchdog-${APP}.json`);
}

function bacaStatus(berkas: string): StatusWatchdog {
  try {
    const isi = JSON.parse(readFileSync(berkas, "utf8")) as { gagal_beruntun?: unknown };
    if (typeof isi.gagal_beruntun === "number" && Number.isInteger(isi.gagal_beruntun)) {
      return { gagal_beruntun: Math.max(0, isi.gagal_beruntun) };
    }
  } catch {}
  return { gagal_beruntun: 0 };
}

function tulisStatus(berkas: string, status: StatusWatchdog): void {
  const sementara = `${berkas}.tmp`;
  writeFileSync(sementara, JSON.stringify(status) + "\n");
  renameSync(sementara, berkas);
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

const ledger = jalurLedger();
const konfig = bacaLingkungan(APP);
const events = bacaLedgerMentah(ledger).events
  .filter(isReleaseEvent)
  .filter((event) => event.app === APP);
const hasil = foldReleaseEvents(events, konfig.productionTarget);
const produksi = hasil.environments.find((env) => env.nama === "production") ?? null;
const aktif = hasil.deployments.find((d) => d.id === produksi?.active_deployment_id) ?? null;

if (!produksi || !aktif) {
  catat({ lewati: "production belum punya deployment aktif" });
  process.exit(0);
}

const url = process.env.AUTORE_WATCHDOG_URL || aktif.health_check_url;
if (!url) {
  catat({ lewati: "deployment aktif tanpa health_check_url", deployment: aktif.id });
  process.exit(0);
}

const berkas = statusPath(ledger);
const sebelumnya = bacaStatus(berkas);
const sehat = await probe(url);
const putusan = putuskanWatchdog(sebelumnya, sehat, AMBANG);
tulisStatus(berkas, putusan.status);

if (putusan.aksi !== "rollback") {
  catat({ sehat, gagal_beruntun: putusan.status.gagal_beruntun, aksi: "biarkan" });
  process.exit(0);
}

const release = hasil.releases.find((r) => r.id === aktif.release_id) ?? null;
if (!release) {
  catat({ sehat, aksi: "tidak_bisa_rollback", alasan: "release deployment aktif tidak ditemukan" });
  process.exit(1);
}
const target = pilihTargetRollback(hasil.deployments, produksi, release);
if (!target) {
  catat({
    sehat,
    aksi: "tidak_bisa_rollback",
    alasan: "tidak ada deployment sehat sebelumnya",
    release: release.id,
  });
  process.exit(1);
}

const rencana = {
  sehat,
  gagal_beruntun: putusan.status.gagal_beruntun,
  release: release.id,
  dari: aktif.id,
  ke: target.id,
  target_digest: target.image_digest,
  probe_url: url,
};

if (MODE === "dry-run") {
  catat({ aksi: "akan_rollback", ...rencana });
  process.exit(0);
}

const keluaran = await hatchRollback().rollback(release.id, "production", WATCHDOG);
catat({ aksi: "rollback", ...rencana, hasil: keluaran });
process.exit(keluaran.ok ? 0 : 1);
