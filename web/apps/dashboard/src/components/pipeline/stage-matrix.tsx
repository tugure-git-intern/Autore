import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatDuration } from "@/lib/format";
import type { StageResult, StageRow } from "@/lib/stages";

/** Nama manusia untuk id tahap kanonik. Id tak dikenal tampil apa adanya. */
const NAMA: Record<string, string> = {
  checkout: "Checkout",
  scan: "Security Scan",
  security_scan: "Security Scan",
  build: "Build",
  pasang: "Push",
  periksa: "Deploy",
  deploy: "Deploy",
};

const TONE: Record<StageResult, BadgeTone> = {
  passed: "green",
  failed: "red",
  running: "amber",
};

const LABEL: Record<StageResult, string> = {
  passed: "Lulus",
  failed: "Gagal",
  running: "Berjalan",
};

const WARNA: Record<StageResult, string> = {
  passed: "border-emerald-200 bg-emerald-50/40 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)]",
  failed: "border-red-300 bg-red-50/40 dark:border-red-800 dark:bg-red-950/50",
  running: "border-amber-200 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/50",
};

/**
 * Snapshot CLI lama belum mencatat `stage_times`, jadi durasi tidak ada sama sekali.
 * Fallback memakai daftar tahap yang sempat mulai: kartu tetap muncul, durasi strip,
 * dan hanya tahap terakhir yang mewarisi status pipeline.
 */
function larik(rows: readonly StageRow[], stages: readonly string[], pipelineStatus: string): StageRow[] {
  if (rows.length > 0) return rows.map((baris) => ({ ...baris }));

  const mulai = stages.map((id) => id.trim()).filter(Boolean);
  const akhir: StageResult =
    pipelineStatus === "failed" ? "failed" : pipelineStatus === "running" ? "running" : "passed";

  return mulai.map((id, urutan) => ({
    id,
    durationMs: null,
    result: urutan === mulai.length - 1 ? akhir : "passed",
  }));
}

/** Matriks kartu per tahap: nomor urut, nama, durasi terukur, chip status. */
export function StageMatrix({
  rows,
  stages,
  pipelineStatus,
}: {
  rows: readonly StageRow[];
  stages: readonly string[];
  pipelineStatus: string;
}) {
  const isi = larik(rows, stages, pipelineStatus);

  if (isi.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-[var(--color-muted)]">Tidak ada data pipeline untuk ditampilkan.</p>;
  }

  return (
    <ol
      aria-label="Tahapan pipeline"
      tabIndex={0}
      className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:overflow-x-auto pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    >
      {isi.map((tahap, urutan) => (
        <li key={`${tahap.id}-${urutan}`} className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          {urutan > 0 ? (
            <span data-testid="stage-arrow" aria-hidden="true" className="self-center text-gray-300 rotate-90 sm:rotate-0 dark:text-[var(--color-muted)]">
              →
            </span>
          ) : null}
          <div
            data-testid="stage-card"
            className={`w-full sm:min-w-[168px] rounded-lg border p-4 ${WARNA[tahap.result]}`}
          >
            <p className="text-[11px] text-gray-400 dark:text-[var(--color-muted)]">{urutan + 1}</p>
            <p className="mt-1 text-sm font-medium capitalize text-gray-900 dark:text-[var(--color-ink)]">
              {NAMA[tahap.id] ?? tahap.id}
            </p>
            <p className="mt-2 font-mono text-xs text-gray-600 dark:text-[var(--color-muted)]">
              {tahap.durationMs === null ? "—" : formatDuration(tahap.durationMs)}
            </p>
            <div className="mt-2">
              <Badge tone={TONE[tahap.result]} role={tahap.result === "failed" ? "alert" : undefined}>
                {LABEL[tahap.result]}
              </Badge>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
