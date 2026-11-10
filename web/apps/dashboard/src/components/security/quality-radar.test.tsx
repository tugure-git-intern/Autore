import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

let mockTheme = "light";
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: mockTheme,
    resolvedTheme: mockTheme,
    setTheme: vi.fn(),
  }),
}));

/** jsdom tidak punya layout: Recharts asli merender 0×0, jadi props yang dicetak. */
vi.mock("recharts", () => {
  const Kotak = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Kotak,
    PolarGrid: ({ stroke }: { stroke?: string }) => (
      <div data-testid="polar-grid" data-stroke={stroke} />
    ),
    PolarAngleAxis: ({ stroke, tick }: { stroke?: string; tick?: { fill?: string } }) => (
      <div data-testid="polar-angle-axis" data-stroke={stroke} data-tick-fill={tick?.fill} />
    ),
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
    mockTheme = "light";
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
    expect(screen.getByTestId("polar-grid").dataset.stroke).toBe("#e5e7eb");
  });

  it("mengubah warna grid dan axis ke #50638b serta teks #ffffff saat Dark Mode", () => {
    mockTheme = "dark";
    render(
      <QualityRadar
        score={{ security: 100, reliability: 66, speed: null, freshness: 80, coverage: 50 }}
      />,
    );

    expect(screen.getByTestId("polar-grid").dataset.stroke).toBe("#50638b");
    expect(screen.getByTestId("polar-angle-axis").dataset.stroke).toBe("#50638b");
    expect(screen.getByTestId("polar-angle-axis").dataset.tickFill).toBe("#ffffff");
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
