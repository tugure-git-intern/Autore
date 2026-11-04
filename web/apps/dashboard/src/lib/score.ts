import type { RadarScore } from "./charts";
import type { DashboardStatus, RunsPayload } from "./contracts";

export type Score = RadarScore;

/** Target build 2 menit: di bawah itu skor kecepatan penuh, di atas 2 menit nol. */
const TARGET_MS = 120_000;
const SEHARI_JAM = 24;

const jepit = (nilai: number) => Math.min(100, Math.max(0, nilai));

function median(angka: number[]): number {
  const urut = [...angka].sort((a, b) => a - b);
  const tengah = Math.floor(urut.length / 2);
  return urut.length % 2 === 1 ? urut[tengah] : (urut[tengah - 1] + urut[tengah]) / 2;
}

/**
 * Lima skor, semuanya dari data yang benar-benar ada. Sumbu tanpa data tetap null —
 * radar yang lebih kecil lebih jujur daripada sumbu bernilai nol karangan.
 */
export function hitungSkor(
  status: DashboardStatus,
  runs: RunsPayload | null,
  now: number = Date.now(),
): Score {
  const { gates_passed = 0, gates_total = 0 } = status.latest_pipeline;

  const daftar = runs?.runs ?? [];
  const totals = runs?.totals ?? { passed: 0, failed: 0, running: 0 };
  const totalBuild = totals.passed + totals.failed + totals.running;

  const sukses = daftar.filter((run) => run.status === "passed").map((run) => run.duration_ms);
  const terbaru = daftar.reduce<string>(
    (paling, run) => (run.started_at > paling ? run.started_at : paling),
    "",
  );
  const umurJam = terbaru ? (now - Date.parse(terbaru)) / 3_600_000 : null;

  const pernahDibangun = new Set(daftar.map((run) => run.app));
  const aplikasi = status.applications;

  return {
    security: gates_total > 0 ? jepit((gates_passed / gates_total) * 100) : null,
    reliability: totalBuild > 0 ? jepit((totals.passed / totalBuild) * 100) : null,
    speed: sukses.length > 0 ? jepit(100 - (median(sukses) / TARGET_MS) * 100) : null,
    freshness:
      umurJam === null || Number.isNaN(umurJam) ? null : jepit(100 - (umurJam / SEHARI_JAM) * 100),
    coverage:
      aplikasi.length > 0
        ? jepit(
            (aplikasi.filter((app) => pernahDibangun.has(app.id)).length / aplikasi.length) * 100,
          )
        : null,
  };
}