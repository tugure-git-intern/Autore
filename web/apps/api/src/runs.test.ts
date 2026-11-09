import { describe, expect, it, vi } from "vitest";
import { validateRuns } from "@autore/contracts";
import { RUNS_ARGS, emptyRuns } from "./runs";

const PAYLOAD = {
  generated_at: "2026-11-04T10:00:00Z",
  window_days: 7,
  runs: [
    {
      app: "tes-web",
      number: 8,
      status: "passed",
      duration_ms: 46892,
      started_at: "2026-11-04T10:01:06Z",
      commit_sha: "2dfd6ef3b42a965dd03c392095a116faf1c8a8c2",
      author: "Autore CLI <autore@tugu-re.com>",
      url: "http://100.80.3.14:8080/job/tes-web/8",
    },
  ],
  daily: [{ date: "2026-11-04", passed: 3, failed: 2 }],
  totals: { passed: 3, failed: 2, running: 0 },
};

const MENIT = 60_000;

/** Cache modul disegarkan tiap tes supaya `lastGood` satu tes tidak menular ke tes lain. */
async function runsModule() {
  vi.resetModules();
  return import("./runs");
}

describe("validateRuns", () => {
  it("menerima payload dari kontrak", () => {
    expect(validateRuns(PAYLOAD)).toEqual(PAYLOAD);
  });

  it("menolak status run yang tidak dikenal", () => {
    const rusak = { ...PAYLOAD, runs: [{ ...PAYLOAD.runs[0], status: "SUCCESS" }] };
    expect(() => validateRuns(rusak)).toThrow();
  });

  it("menolak daily yang bukan array angka", () => {
    expect(() => validateRuns({ ...PAYLOAD, daily: {} })).toThrow();
    expect(() =>
      validateRuns({ ...PAYLOAD, daily: [{ date: "2026-11-04", passed: "3", failed: 0 }] }),
    ).toThrow();
    expect(() => validateRuns({ ...PAYLOAD, daily: [{ date: "2026-11-04", passed: 3 }] })).toThrow();
  });

  it("menolak kunci asing dan field yang hilang", () => {
    expect(() => validateRuns({ ...PAYLOAD, tambahan: 1 })).toThrow();
    expect(() => validateRuns({ ...PAYLOAD, totals: { passed: 1 } })).toThrow();
    const tanpaWaktu: Record<string, unknown> = { ...PAYLOAD };
    delete tanpaWaktu.generated_at;
    expect(() => validateRuns(tanpaWaktu)).toThrow();
    expect(() => validateRuns("bukan objek")).toThrow();
  });

  it("menolak durasi yang bukan angka wajar", () => {
    expect(() => validateRuns({ ...PAYLOAD, runs: [{ ...PAYLOAD.runs[0], duration_ms: -1 }] })).toThrow();
    expect(() =>
      validateRuns({ ...PAYLOAD, runs: [{ ...PAYLOAD.runs[0], duration_ms: "46892" }] }),
    ).toThrow();
  });
});

describe("getRuns", () => {
  it("memakai argv tetap yang tidak bisa disisipi input pengguna", async () => {
    const { getRuns } = await runsModule();
    const runner = vi.fn(async () => JSON.stringify(PAYLOAD));

    await getRuns(runner, () => 1_000);

    expect(runner).toHaveBeenCalledWith(RUNS_ARGS);
    expect(RUNS_ARGS).toEqual(["runs", "--json", "--days", "7", "--limit", "5"]);
  });

  it("memakai cache selama 60 detik", async () => {
    const { getRuns } = await runsModule();
    const runner = vi.fn(async () => JSON.stringify(PAYLOAD));
    let sekarang = 1_000;

    await getRuns(runner, () => sekarang);
    sekarang += 59 * 1000;
    const kedua = await getRuns(runner, () => sekarang);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(kedua).toEqual({ data: PAYLOAD, stale: false });
  });

  it("jatuh ke data terakhir yang baik dengan penanda stale saat CLI gagal", async () => {
    const { getRuns } = await runsModule();
    let gagal = false;
    let sekarang = 1_000;
    const runner = vi.fn(async () => {
      if (gagal) throw new Error("autore tidak ditemukan");
      return JSON.stringify(PAYLOAD);
    });
    await getRuns(runner, () => sekarang);

    gagal = true;
    sekarang += 2 * MENIT;
    const hasil = await getRuns(runner, () => sekarang);

    expect(hasil).toEqual({ data: PAYLOAD, stale: true });
  });

  it("tetap menjawab bentuk kosong saat belum pernah ada data baik", async () => {
    const { getRuns } = await runsModule();
    const runner = vi.fn(async () => {
      throw new Error("autore gagal");
    });

    const hasil = await getRuns(runner, () => Date.parse("2026-11-04T10:00:00Z"));

    expect(hasil.stale).toBe(true);
    expect(hasil.data.runs).toEqual([]);
    expect(hasil.data.totals).toEqual({ passed: 0, failed: 0, running: 0 });
    expect(hasil.data.daily).toHaveLength(7);
    expect(hasil.data.daily.every((hari) => hari.passed === 0 && hari.failed === 0)).toBe(true);
    expect(hasil.data.daily[6].date).toBe("2026-11-04");
  });

  it("menolak balasan CLI yang bentuknya salah, bukan menampilkannya", async () => {
    const { getRuns } = await runsModule();
    const runner = vi.fn(async () => JSON.stringify({ ...PAYLOAD, window_days: "7" }));

    const hasil = await getRuns(runner, () => 1_000);

    expect(hasil.stale).toBe(true);
    expect(hasil.data.runs).toEqual([]);
  });
});

describe("emptyRuns", () => {
  it("membuat jendela nol yang urut berdasarkan waktu", () => {
    const kosong = emptyRuns(Date.parse("2026-11-04T10:00:00Z"));

    expect(kosong.window_days).toBe(7);
    expect(kosong.daily.map((hari) => hari.date)).toEqual([
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
  });
});
