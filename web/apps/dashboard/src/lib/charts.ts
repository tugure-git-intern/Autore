import type { DailyPoint, RunTotals } from "./contracts";

export const CHART_COLORS = {
  passed: "#16a34a",
  failed: "#dc2626",
  running: "#f59e0b",
  grid: "#e5e7eb",
} as const;

export type TrendPoint = { label: string; passed: number; failed: number };

/** Tanggal UTC "2026-11-04" → label pendek "04/11" supaya sumbu X tidak berdesakan. */
export function toTrend(daily: readonly DailyPoint[]): TrendPoint[] {
  return daily.map((hari) => ({
    label: `${hari.date.slice(8, 10)}/${hari.date.slice(5, 7)}`,
    passed: hari.passed,
    failed: hari.failed,
  }));
}

export type Slice = {
  key: "passed" | "failed" | "running";
  name: string;
  value: number;
  fill: string;
};

/** Tiga irisan tetap, termasuk yang bernilai nol, supaya warna legenda stabil. */
export function toSlices(totals: RunTotals): Slice[] {
  return [
    { key: "passed", name: "Lulus", value: totals.passed, fill: CHART_COLORS.passed },
    { key: "failed", name: "Gagal", value: totals.failed, fill: CHART_COLORS.failed },
    { key: "running", name: "Berjalan", value: totals.running, fill: CHART_COLORS.running },
  ];
}

export type RadarScore = {
  security: number | null;
  reliability: number | null;
  speed: number | null;
  freshness: number | null;
  coverage: number | null;
};

export type RadarAxis = { axis: string; value: number };

const AXES: Array<[keyof RadarScore, string]> = [
  ["security", "Keamanan"],
  ["reliability", "Keandalan"],
  ["speed", "Kecepatan"],
  ["freshness", "Kesegaran"],
  ["coverage", "Cakupan"],
];

/** Sumbu tanpa data tidak digambar: radar yang lebih kecil lebih jujur daripada sumbu nol. */
export function toRadar(score: RadarScore): RadarAxis[] {
  return AXES.flatMap(([kunci, axis]) => {
    const nilai = score[kunci];
    if (nilai === null || nilai === undefined || !Number.isFinite(nilai)) return [];
    return [{ axis, value: Math.min(100, Math.max(0, Math.round(nilai))) }];
  });
}
