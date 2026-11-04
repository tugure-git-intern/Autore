import { describe, expect, it } from "vitest";
import { CHART_COLORS, toRadar, toSlices, toTrend } from "./charts";

describe("toTrend", () => {
  it("label tren dari tanggal UTC", () => {
    expect(toTrend([{ date: "2026-11-04", passed: 2, failed: 1 }])).toEqual([
      { label: "04/11", passed: 2, failed: 1 },
    ]);
  });

  it("hari tanpa build tetap jadi titik nol", () => {
    const seri = toTrend([
      { date: "2026-11-03", passed: 0, failed: 0 },
      { date: "2026-11-04", passed: 3, failed: 2 },
    ]);

    expect(seri).toHaveLength(2);
    expect(seri[0]).toEqual({ label: "03/11", passed: 0, failed: 0 });
  });
});

describe("toSlices", () => {
  it("donut selalu tiga irisan berurutan passed, failed, running", () => {
    const irisan = toSlices({ passed: 5, failed: 2, running: 0 });

    expect(irisan.map((s) => s.key)).toEqual(["passed", "failed", "running"]);
    expect(irisan.map((s) => s.name)).toEqual(["Lulus", "Gagal", "Berjalan"]);
    expect(irisan.map((s) => s.value)).toEqual([5, 2, 0]);
    expect(irisan.map((s) => s.fill)).toEqual([
      CHART_COLORS.passed,
      CHART_COLORS.failed,
      CHART_COLORS.running,
    ]);
  });

  it("donut nol total tidak membagi nol", () => {
    const irisan = toSlices({ passed: 0, failed: 0, running: 0 });

    expect(irisan).toHaveLength(3);
    expect(irisan.every((s) => s.value === 0)).toBe(true);
  });
});

describe("toRadar", () => {
  it("radar membuang sumbu tanpa data", () => {
    const sumbu = toRadar({
      security: 100,
      reliability: 66,
      speed: null,
      freshness: 80,
      coverage: 50,
    });

    expect(sumbu).toHaveLength(4);
    expect(sumbu.map((s) => s.axis)).toEqual(["Keamanan", "Keandalan", "Kesegaran", "Cakupan"]);
    expect(sumbu.map((s) => s.value)).toEqual([100, 66, 80, 50]);
  });

  it("radar membatasi 0..100 dan membulatkan", () => {
    const sumbu = toRadar({
      security: 140,
      reliability: -5,
      speed: 66.4,
      freshness: null,
      coverage: null,
    });

    expect(sumbu.map((s) => s.value)).toEqual([100, 0, 66]);
  });

  it("tanpa data sama sekali jadi daftar kosong", () => {
    expect(
      toRadar({ security: null, reliability: null, speed: null, freshness: null, coverage: null }),
    ).toEqual([]);
  });
});
