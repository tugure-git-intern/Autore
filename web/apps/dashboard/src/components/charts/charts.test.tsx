import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Boxes } from "lucide-react";

let mockTheme = "light";
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: mockTheme,
    resolvedTheme: mockTheme,
    setTheme: vi.fn(),
  }),
}));

/**
 * jsdom tidak punya layout, jadi Recharts asli merender 0×0 dan tes berhenti
 * menguji apa pun. Stub ini mencetak props yang benar-benar dikirim komponen.
 */
vi.mock("recharts", () => {
  const Kotak = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Kotak,
    CartesianGrid: ({ stroke }: { stroke?: string }) => (
      <div data-testid="cartesian-grid" data-stroke={stroke} />
    ),
    XAxis: ({ stroke, tick }: { stroke?: string; tick?: { fill?: string } }) => (
      <div data-testid="x-axis" data-stroke={stroke} data-tick-fill={tick?.fill} />
    ),
    YAxis: ({ stroke, tick }: { stroke?: string; tick?: { fill?: string } }) => (
      <div data-testid="y-axis" data-stroke={stroke} data-tick-fill={tick?.fill} />
    ),
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

import { Card } from "../ui/card";
import { ChartCard } from "../ui/chart-card";
import { StatCard } from "../stat-card";
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
    mockTheme = "light";
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
    expect(screen.getByTestId("cartesian-grid").dataset.stroke).toBe("#e5e7eb");
    expect(screen.getByTestId("x-axis").dataset.tickFill).toBe("#64748b");
  });

  it("mengubah warna grid dan axis ke #50638b serta teks tick #ffffff saat Dark Mode", () => {
    mockTheme = "dark";
    render(<RunTrends daily={TUJUH_HARI} />);

    expect(screen.getByTestId("cartesian-grid").dataset.stroke).toBe("#50638b");
    expect(screen.getByTestId("x-axis").dataset.stroke).toBe("#50638b");
    expect(screen.getByTestId("y-axis").dataset.stroke).toBe("#50638b");
    expect(screen.getByTestId("x-axis").dataset.tickFill).toBe("#ffffff");
    expect(screen.getByTestId("y-axis").dataset.tickFill).toBe("#ffffff");
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

describe("Card, ChartCard, dan StatCard Dark Mode", () => {
  it("menerapkan latar #353b43, border #50638b, dan teks #ffffff pada Dark Mode", () => {
    const { container } = render(
      <div>
        <Card>Isi Kartu</Card>
        <ChartCard title="Judul Grafik" subtitle="Subjudul">
          <div>Grafik</div>
        </ChartCard>
        <StatCard label="Total" value="10" icon={Boxes} />
      </div>,
    );

    const cardEl = screen.getByText("Isi Kartu");
    expect(cardEl.className).toContain("bg-white");
    expect(cardEl.className).toContain("dark:bg-[#353b43]");
    expect(cardEl.className).toContain("dark:border-[#50638b]");

    const sections = container.querySelectorAll("section");
    for (const sec of sections) {
      expect(sec.className).toContain("bg-white");
      expect(sec.className).toContain("dark:bg-[#353b43]");
      expect(sec.className).toContain("dark:border-[#50638b]");
    }
  });
});
