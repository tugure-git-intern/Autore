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
