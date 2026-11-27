import type { DailyPoint, RunTotals } from "./contracts";
import { BAHASA_BAWAAN, terjemah, type Bahasa, type KunciTerjemah } from "./i18n";

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

const namaIrisan = {
  id: { passed: "Lulus", failed: "Gagal", running: "Berjalan" },
  en: { passed: "Passed", failed: "Failed", running: "Running" },
} as const;

/** Tiga irisan tetap, termasuk yang bernilai nol, supaya warna legenda stabil. */
export function toSlices(totals: RunTotals, bahasa: Bahasa = BAHASA_BAWAAN): Slice[] {
  const nama = namaIrisan[bahasa];
  return [
    { key: "passed", name: nama.passed, value: totals.passed, fill: CHART_COLORS.passed },
    { key: "failed", name: nama.failed, value: totals.failed, fill: CHART_COLORS.failed },
    { key: "running", name: nama.running, value: totals.running, fill: CHART_COLORS.running },
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

const AXES: Array<[keyof RadarScore, KunciTerjemah]> = [
  ["security", "radar.keamanan"],
  ["reliability", "radar.keandalan"],
  ["speed", "radar.kecepatan"],
  ["freshness", "radar.kesegaran"],
  ["coverage", "radar.cakupan"],
];

/** Sumbu tanpa data tidak digambar: radar yang lebih kecil lebih jujur daripada sumbu nol. */
export function toRadar(score: RadarScore, bahasa: Bahasa = BAHASA_BAWAAN): RadarAxis[] {
  return AXES.flatMap(([kunci, label]) => {
    const nilai = score[kunci];
    if (nilai === null || nilai === undefined || !Number.isFinite(nilai)) return [];
    return [{ axis: terjemah(bahasa, label), value: Math.min(100, Math.max(0, Math.round(nilai))) }];
  });
}
