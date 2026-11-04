import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/** jsdom tidak punya layout: Recharts asli merender 0×0, jadi props yang dicetak. */
vi.mock("recharts", () => {
  const Kotak = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Kotak,
    PolarGrid: Kotak,
    PolarAngleAxis: Kotak,
    PolarRadiusAxis: Kotak,
    RadarChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="radar-chart" data-points={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Radar: ({ dataKey, stroke, fill }: { dataKey?: string; stroke?: string; fill?: string }) => (
      <div data-testid="radar-seri" data-key={dataKey} data-stroke={stroke} data-fill={fill} />
    ),
  };
});

import { QualityRadar } from "./quality-radar";

describe("QualityRadar", () => {
  it("hanya mengirim sumbu yang terukur", () => {
    render(
      <QualityRadar
        score={{ security: 100, reliability: 66, speed: null, freshness: 80, coverage: 50 }}
      />,
    );

    const titik = JSON.parse(screen.getByTestId("radar-chart").dataset.points ?? "[]");
    expect(titik.map((t: { axis: string }) => t.axis)).toEqual([
      "Keamanan",
      "Keandalan",
      "Kesegaran",
      "Cakupan",
    ]);
    expect(screen.getByTestId("radar-seri").dataset.stroke).toBe("#0f766e");
  });

  it("empty state saat semua sumbu null, bukan radar nol", () => {
    render(
      <QualityRadar
        score={{ security: null, reliability: null, speed: null, freshness: null, coverage: null }}
      />,
    );

    expect(screen.getByText("Belum ada data untuk dinilai")).toBeVisible();
    expect(screen.queryByTestId("radar-chart")).toBeNull();
  });
});