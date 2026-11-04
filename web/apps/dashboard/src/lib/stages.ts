import type { StageTime, StatusValue } from "./contracts";

export type StageResult = "passed" | "failed" | "running";

export type StageRow = {
  id: string;
  /** null saat tahap belum punya tahap berikutnya yang tercatat — bukan 0 detik. */
  durationMs: number | null;
  result: StageResult;
};

/**
 * Durasi tiap tahap dihitung dari selisih waktu mulai antar tahap; tahap terakhir
 * memakai `finished_at`. Snapshot lama (sebelum CLI mencatat waktu) tidak punya
 * `stage_times` sama sekali — hasilnya daftar kosong, bukan angka karangan.
 */
export function stageRows(
  stageTimes: readonly StageTime[] = [],
  finishedAt = "",
  pipelineStatus: StatusValue | string = "unknown",
): StageRow[] {
  if (stageTimes.length === 0) return [];

  return stageTimes.map((tahap, urutan) => {
    const berikutnya = stageTimes[urutan + 1]?.at ?? finishedAt;
    return {
      id: tahap.id,
      durationMs: selisih(tahap.at, berikutnya),
      result: urutan === stageTimes.length - 1 ? warisiStatus(pipelineStatus) : "passed",
    };
  });
}

function selisih(mulai: string, selesai: string): number | null {
  const awal = Date.parse(mulai);
  const akhir = Date.parse(selesai);
  if (Number.isNaN(awal) || Number.isNaN(akhir)) return null;

  const milidetik = akhir - awal;
  return milidetik > 0 ? milidetik : null;
}

function warisiStatus(status: StatusValue | string): StageResult {
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "passed";
}
