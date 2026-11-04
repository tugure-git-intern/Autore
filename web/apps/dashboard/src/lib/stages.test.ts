import { describe, expect, it } from "vitest";
import { stageRows } from "./stages";

const jam = (waktu: string) => `2026-11-04T${waktu}Z`;

const PIPELINE = [
  { id: "checkout", at: jam("10:00:00") },
  { id: "scan", at: jam("10:00:30") },
  { id: "build", at: jam("10:01:30") },
];

describe("stageRows", () => {
  it("durasi = selisih timestamp tahap berikutnya, tahap terakhir pakai finished_at", () => {
    expect(stageRows(PIPELINE, jam("10:02:00"), "passed")).toEqual([
      { id: "checkout", durationMs: 30_000, result: "passed" },
      { id: "scan", durationMs: 60_000, result: "passed" },
      { id: "build", durationMs: 30_000, result: "passed" },
    ]);
  });

  it("tahap terakhir tanpa waktu, bukan nol", () => {
    expect(stageRows(PIPELINE, "", "running").at(-1)?.durationMs).toBeNull();
  });

  it("snapshot lama tanpa stage_times jadi daftar kosong", () => {
    expect(stageRows([], "", "passed")).toEqual([]);
  });

  it("tahap terakhir mewarisi status pipeline", () => {
    const gagal = stageRows(PIPELINE, jam("10:02:00"), "failed");
    expect(gagal.map((baris) => baris.result)).toEqual(["passed", "passed", "failed"]);

    const berjalan = stageRows(PIPELINE, "", "running");
    expect(berjalan.at(-1)?.result).toBe("running");
  });

  it("tanpa finished_at, tahap terakhir durationMs null", () => {
    expect(stageRows(PIPELINE, "", "running").at(-1)?.durationMs).toBeNull();
  });

  it("durasi nol atau negatif jadi null, urutan tidak diubah", () => {
    const terbalik = stageRows(
      [
        { id: "build", at: jam("10:01:30") },
        { id: "checkout", at: jam("10:00:00") },
      ],
      jam("10:02:00"),
      "passed",
    );

    expect(terbalik.map((baris) => baris.id)).toEqual(["build", "checkout"]);
    expect(terbalik[0].durationMs).toBeNull();
    expect(terbalik[1].durationMs).toBe(120_000);
  });

  it("timestamp rusak jadi null, bukan NaN", () => {
    const rows = stageRows(
      [
        { id: "checkout", at: "bukan-tanggal" },
        { id: "scan", at: jam("10:00:30") },
      ],
      jam("10:01:00"),
      "passed",
    );

    expect(rows[0].durationMs).toBeNull();
  });
});
