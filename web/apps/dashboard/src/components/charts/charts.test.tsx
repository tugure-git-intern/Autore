import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * jsdom tidak punya layout, jadi Recharts asli merender 0×0 dan tes berhenti
 * menguji apa pun. Stub ini mencetak props yang benar-benar dikirim komponen.
 */
vi.mock("recharts", () => {
  const Kotak = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Kotak,
    CartesianGrid: Kotak,
    XAxis: Kotak,
    YAxis: Kotak,
    Tooltip: Kotak,
    PieChart: Kotak,
    AreaChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="area-chart" data-points={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Area: ({ dataKey, stroke, fill }: { dataKey?: string; stroke?: string; fill?: string }) => (
      <div data-testid={`area-${dataKey}`} data-stroke={stroke} data-fill={fill} />
    ),
    Pie: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="pie" data-slices={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Cell: ({ fill }: { fill?: string }) => <div data-testid="cell" data-fill={fill} />,
  };
});

import { RunDistribution } from "./run-distribution";
import { RunTrends } from "./run-trends";

const TUJUH_HARI = [
  { date: "2026-10-29", passed: 0, failed: 0 },
  { date: "2026-10-30", passed: 0, failed: 0 },
  { date: "2026-10-31", passed: 0, failed: 0 },
  { date: "2026-11-01", passed: 0, failed: 0 },
  { date: "2026-11-02", passed: 0, failed: 0 },
  { date: "2026-11-03", passed: 1, failed: 0 },
  { date: "2026-11-04", passed: 3, failed: 2 },
];

describe("RunTrends", () => {
  it("mengirim 7 titik dan dua seri dengan warna hasil", () => {
    render(<RunTrends daily={TUJUH_HARI} />);

    const chart = screen.getByTestId("area-chart");
    expect(JSON.parse(chart.dataset.points ?? "[]")).toHaveLength(7);
    expect(JSON.parse(chart.dataset.points ?? "[]")[6]).toEqual({
      label: "04/11",
      passed: 3,
      failed: 2,
    });

    expect(screen.getByTestId("area-passed").dataset.stroke).toBe("#16a34a");
    expect(screen.getByTestId("area-failed").dataset.stroke).toBe("#dc2626");
  });

  it("menampilkan empty state saat semua nol", () => {
    render(<RunTrends daily={TUJUH_HARI.map((hari) => ({ ...hari, passed: 0, failed: 0 }))} />);

    expect(screen.getByText("Belum ada build dalam 7 hari terakhir")).toBeInTheDocument();
    expect(screen.queryByTestId("area-chart")).toBeNull();
  });

  it("menangani jendela kosong tanpa NaN", () => {
    render(<RunTrends daily={[]} />);

    expect(screen.getByText("Belum ada build dalam 7 hari terakhir")).toBeInTheDocument();
  });
});

describe("RunDistribution", () => {
  const TOTALS = { passed: 5, failed: 2, running: 1 };

  it("menampilkan tiga irisan dan total di tengah", () => {
    render(<RunDistribution totals={TOTALS} />);

    const irisan = JSON.parse(screen.getByTestId("pie").dataset.slices ?? "[]");
    expect(irisan.map((s: { value: number }) => s.value)).toEqual([5, 2, 1]);
    expect(screen.getAllByTestId("cell")).toHaveLength(3);
    expect(screen.getByText("8")).toBeInTheDocument();

    for (const baris of ["Lulus", "Gagal", "Berjalan"]) {
      const item = screen.getByText(baris).closest("li");
      expect(item).not.toBeNull();
    }
    expect(within(screen.getByText("Lulus").closest("li") as HTMLElement).getByText("5")).toBeInTheDocument();
    expect(within(screen.getByText("Gagal").closest("li") as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(
      within(screen.getByText("Berjalan").closest("li") as HTMLElement).getByText("1"),
    ).toBeInTheDocument();
  });

  it("total nol tidak menampilkan NaN", () => {
    const { container } = render(<RunDistribution totals={{ passed: 0, failed: 0, running: 0 }} />);

    expect(screen.getByTestId("donut-total")).toHaveTextContent("0");
    expect(container.textContent).not.toContain("NaN");
  });
});
