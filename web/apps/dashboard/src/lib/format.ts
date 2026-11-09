/** Waktu dan durasi untuk tabel Recent Runs. Angka yang belum ada jadi "—", bukan nol palsu. */

export function relativeTime(iso: string, now: number = Date.now()): string {
  const waktu = Date.parse(iso);
  if (Number.isNaN(waktu)) return "—";

  const detik = Math.max(0, Math.floor((now - waktu) / 1000));
  if (detik < 60) return "baru saja";
  if (detik < 3600) return `${Math.floor(detik / 60)} menit lalu`;
  if (detik < 86_400) return `${Math.floor(detik / 3600)} jam lalu`;
  return `${Math.floor(detik / 86_400)} hari lalu`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const detik = ms / 1000;
  if (detik < 60) return `${detik.toFixed(1)}s`;

  const menit = Math.floor(detik / 60);
  return `${menit}m ${Math.round(detik - menit * 60)}s`;
}

export type PipelineWaktu = {
  started_at?: string;
  finished_at?: string;
  stage_times?: readonly { id: string; at: string }[];
};

/**
 * Hitung selisih dari finished_at ke started_at di latest_pipeline.
 * Format: "Xm Ys" (misal "1m 45s"). Kosong / belum ada -> "-".
 * started_at fallback ke stage_times[0].at bila belum tersedia di level root.
 */
export function parseLeadTime(
  pipeline?: PipelineWaktu | null,
): { menit: number; detik: number } | null {
  if (!pipeline) return null;
  const mulai = pipeline.started_at ?? pipeline.stage_times?.[0]?.at;
  const selesai = pipeline.finished_at;
  if (!mulai || !selesai) return null;

  const awal = Date.parse(mulai);
  const akhir = Date.parse(selesai);
  if (Number.isNaN(awal) || Number.isNaN(akhir) || akhir < awal) return null;

  const detikTotal = Math.floor((akhir - awal) / 1000);
  return {
    menit: Math.floor(detikTotal / 60),
    detik: detikTotal % 60,
  };
}

export function formatLeadTime(pipeline?: PipelineWaktu | null): string {
  const parsed = parseLeadTime(pipeline);
  if (!parsed) return "-";
  return `${parsed.menit}m ${parsed.detik}s`;
}

export function shortSha(sha: string): string {
  const bersih = sha.trim();
  return bersih ? bersih.slice(0, 7) : "—";
}

/** Avatar kartu: dua huruf pertama nama. Format CLI `Nama <email>`; tanpa nama jadi "?". */
export function inisial(nama: string): string {
  const kata = (nama.split("<")[0] ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (kata.length === 0) return "?";
  return kata
    .slice(0, 2)
    .map((k) => k[0])
    .join("")
    .toUpperCase();
}

/** CLI sends "" (never null) for unavailable text. Empty must render as a dash, not as a fake value. */
export function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}
