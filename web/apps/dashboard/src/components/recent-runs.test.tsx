import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "@/lib/contracts";
import { RecentRuns } from "./recent-runs";

const jamLalu = (jam: number) => new Date(Date.now() - jam * 3_600_000).toISOString();

const run = (number: number, extra: Partial<RunRecord> = {}): RunRecord => ({
  app: "tes-web",
  number,
  status: "passed",
  duration_ms: 45_244,
  started_at: jamLalu(3),
  commit_sha: "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2",
  author: "Autore CLI <autore@tugu-re.com>",
  url: `http://100.80.3.14:8080/job/tes-web/${number}`,
  ...extra,
});

const rows = () => screen.getAllByTestId("recent-run-row");

describe("RecentRuns", () => {
  it("menampilkan maksimal 5 baris", () => {
    render(<RecentRuns runs={[1, 2, 3, 4, 5, 6, 7].map((n) => run(n))} />);

    expect(rows()).toHaveLength(5);
  });

  it("menampilkan commit 7 karakter sebagai tautan ke build", () => {
    render(<RecentRuns runs={[run(9)]} />);

    const tautan = within(rows()[0]).getByRole("link", { name: "2dfd6ef" });
    expect(tautan).toHaveAttribute("href", "http://100.80.3.14:8080/job/tes-web/9");
    expect(tautan).toHaveAttribute("target", "_blank");
    expect(tautan).toHaveAttribute("rel", "noreferrer");
  });

  it("author kosong jadi strip, bukan teks kosong", () => {
    render(<RecentRuns runs={[run(9, { author: "" })]} />);

    expect(within(rows()[0]).getByText("—")).toBeInTheDocument();
  });

  it("menampilkan badge status, durasi, dan waktu relatif", () => {
    render(<RecentRuns runs={[run(9)]} />);

    const baris = rows()[0];
    expect(within(baris).getByText("Lulus")).toBeInTheDocument();
    expect(within(baris).getByText("45.2s")).toBeInTheDocument();
    expect(within(baris).getByText("3 jam lalu")).toBeInTheDocument();
    expect(within(baris).getByText("tes-web #9")).toBeInTheDocument();
  });

  it("menandai data terakhir saat respons stale", () => {
    render(<RecentRuns runs={[run(9)]} stale />);

    expect(screen.getByText("data terakhir")).toBeInTheDocument();
  });

  it("empty state saat tidak ada run", () => {
    render(<RecentRuns runs={[]} />);

    expect(screen.getByText("Belum ada run")).toBeInTheDocument();
    expect(screen.queryAllByTestId("recent-run-row")).toHaveLength(0);
  });
});
