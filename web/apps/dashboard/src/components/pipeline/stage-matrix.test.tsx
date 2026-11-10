import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StageRow } from "@/lib/stages";
import { StageMatrix } from "./stage-matrix";

const LIMA: StageRow[] = [
  { id: "checkout", durationMs: null, result: "passed" },
  { id: "scan", durationMs: 30_000, result: "passed" },
  { id: "build", durationMs: 60_000, result: "passed" },
  { id: "pasang", durationMs: 12_000, result: "passed" },
  { id: "periksa", durationMs: 4_000, result: "passed" },
];

const kartu = () => screen.getAllByTestId("stage-card");

describe("StageMatrix", () => {
  it("merender satu kartu per tahap", () => {
    render(<StageMatrix rows={LIMA} stages={[]} pipelineStatus="passed" />);

    expect(kartu()).toHaveLength(5);
  });

  it("durasi tampil per kartu, tahap tanpa waktu jadi strip", () => {
    render(<StageMatrix rows={LIMA} stages={[]} pipelineStatus="passed" />);

    expect(kartu()[0].textContent).toContain("—");
    expect(kartu()[1].textContent).toContain("30.0s");
    expect(kartu()[2].textContent).toContain("1m 0s");
  });

  it("memakai nama tahap yang bisa dibaca manusia, id tak dikenal apa adanya", () => {
    render(
      <StageMatrix
        rows={[...LIMA, { id: "lint", durationMs: 1_000, result: "passed" }]}
        stages={[]}
        pipelineStatus="passed"
      />,
    );

    expect(kartu()[0].textContent).toContain("Checkout");
    expect(kartu()[1].textContent).toContain("Security Scan");
    expect(kartu()[4].textContent).toContain("Deploy");
    expect(kartu()[5].textContent).toContain("lint");
  });

  it("kartu gagal berwarna merah dan punya tanda", () => {
    render(
      <StageMatrix
        rows={[...LIMA.slice(0, 4), { id: "periksa", durationMs: null, result: "failed" }]}
        stages={[]}
        pipelineStatus="failed"
      />,
    );

    const terakhir = kartu().at(-1)!;
    expect(terakhir.className).toContain("border-red-300");
    expect(within(terakhir).getByRole("alert")).toHaveTextContent("Gagal");
  });

  it("snapshot lama tanpa stage_times tetap merender kartu dari stages", () => {
    render(<StageMatrix rows={[]} stages={["checkout", "scan"]} pipelineStatus="passed" />);

    expect(kartu()).toHaveLength(2);
    expect(kartu()[0].textContent).toContain("Checkout");
    expect(kartu()[1].textContent).toContain("Security Scan");
    for (const satu of kartu()) expect(satu.textContent).toContain("—");
  });

  it("menampilkan nomor urut dan panah antar kartu", () => {
    render(<StageMatrix rows={LIMA.slice(0, 2)} stages={[]} pipelineStatus="passed" />);

    expect(kartu()[0].textContent).toContain("1");
    expect(kartu()[1].textContent).toContain("2");
    expect(screen.getAllByTestId("stage-arrow")).toHaveLength(1);
  });

  it("empty state saat pipeline belum punya tahap sama sekali", () => {
    render(<StageMatrix rows={[]} stages={[]} pipelineStatus="idle" />);

    expect(screen.getByText("Tidak ada data pipeline untuk ditampilkan.")).toBeVisible();
    expect(screen.queryAllByTestId("stage-card")).toHaveLength(0);
  });

  it("kartu tahap memakai variabel CSS Dark Mode agar tidak menyala putih", () => {
    render(<StageMatrix rows={LIMA.slice(0, 1)} stages={[]} pipelineStatus="passed" />);
    expect(kartu()[0].className).toContain("dark:border-[var(--color-line)]");
    expect(kartu()[0].className).toContain("dark:bg-[var(--bg-sidebar)]");
  });
});
