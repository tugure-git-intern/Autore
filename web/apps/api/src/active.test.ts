import { describe, expect, it, vi } from "vitest";
import { validateActive } from "@autore/contracts";
import { ACTIVE_ARGS, emptyActive } from "./active";

const PAYLOAD = {
  generated_at: "2026-11-05T03:40:00Z",
  active: [
    {
      app: "tes-web",
      number: 42,
      status: "running",
      branch: "main",
      commit_sha: "3878d9307475eb84316edde4e77f63fd0b98ae4e",
      author: "Uji <uji@example.test>",
      started_at: "2026-11-05T03:23:08Z",
      url: "http://100.80.3.14:8080/job/tes-web/42",
    },
    {
      app: "ui-demo",
      number: 0,
      status: "queued",
      branch: "",
      commit_sha: "",
      author: "",
      started_at: "2026-11-05T03:25:00Z",
      url: "http://100.80.3.14:8080/job/ui-demo",
    },
  ],
  counts: { running: 1, queued: 1 },
};

/** Cache modul disegarkan tiap tes supaya `lastGood` satu tes tidak menular ke tes lain. */
async function activeModule() {
  vi.resetModules();
  return import("./active");
}

describe("validateActive", () => {
  it("menerima payload dari kontrak", () => {
    expect(validateActive(PAYLOAD)).toEqual(PAYLOAD);
  });

  it("menolak status yang tidak dikenal", () => {
    expect(() =>
      validateActive({ ...PAYLOAD, active: [{ ...PAYLOAD.active[0], status: "SUCCESS" }] }),
    ).toThrow();
  });

  it("menolak kunci asing dan field yang hilang", () => {
    expect(() => validateActive({ ...PAYLOAD, tambahan: 1 })).toThrow();
    expect(() => validateActive({ ...PAYLOAD, counts: { running: 1 } })).toThrow();
    const tanpaWaktu: Record<string, unknown> = { ...PAYLOAD };
    delete tanpaWaktu.generated_at;
    expect(() => validateActive(tanpaWaktu)).toThrow();
    expect(() => validateActive("bukan objek")).toThrow();
    expect(() =>
      validateActive({ ...PAYLOAD, active: [{ ...PAYLOAD.active[0], branch: undefined }] }),
    ).toThrow();
  });

  it("menolak nomor build yang bukan angka wajar", () => {
    expect(() => validateActive({ ...PAYLOAD, active: [{ ...PAYLOAD.active[0], number: -1 }] })).toThrow();
    expect(() =>
      validateActive({ ...PAYLOAD, active: [{ ...PAYLOAD.active[0], number: "42" }] }),
    ).toThrow();
    expect(() => validateActive({ ...PAYLOAD, counts: { running: -1, queued: 0 } })).toThrow();
  });
});

describe("getActive", () => {
  it("memakai argv tetap yang tidak bisa disisipi input pengguna", async () => {
    const { getActive } = await activeModule();
    const runner = vi.fn(async () => JSON.stringify(PAYLOAD));

    await getActive(runner, () => 1_000);

    expect(runner).toHaveBeenCalledWith(ACTIVE_ARGS);
    expect(ACTIVE_ARGS).toEqual(["active", "--json"]);
  });

  it("memakai cache lima detik supaya polling sepuluh detik tidak menambah beban", async () => {
    const { getActive } = await activeModule();
    const runner = vi.fn(async () => JSON.stringify(PAYLOAD));
    let sekarang = 1_000;

    await getActive(runner, () => sekarang);
    sekarang += 4_999;
    await getActive(runner, () => sekarang);
    expect(runner).toHaveBeenCalledTimes(1);

    sekarang += 1;
    await getActive(runner, () => sekarang);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("CLI gagal mempertahankan hasil terakhir dengan penanda stale", async () => {
    const { getActive } = await activeModule();
    let gagal = false;
    const runner = vi.fn(async () => {
      if (gagal) throw new Error("autore mati");
      return JSON.stringify(PAYLOAD);
    });

    await getActive(runner, () => 1_000);
    gagal = true;
    const hasil = await getActive(runner, () => 10_000);

    expect(hasil.stale).toBe(true);
    expect(hasil.data.active).toHaveLength(2);
  });

  it("tanpa hasil baik sebelumnya tetap daftar kosong, bukan 500", async () => {
    const { getActive } = await activeModule();
    const runner = vi.fn(async () => {
      throw new Error("autore mati");
    });

    const hasil = await getActive(runner, () => Date.parse("2026-11-05T03:40:00Z"));

    expect(hasil.stale).toBe(true);
    expect(hasil.data.active).toEqual([]);
    expect(hasil.data.counts).toEqual({ running: 0, queued: 0 });
    expect(hasil.data.generated_at).toBe("2026-11-05T03:40:00.000Z");
  });

  it("JSON rusak tidak dilempar keluar", async () => {
    const { getActive } = await activeModule();
    const runner = vi.fn(async () => "<html>502</html>");

    const hasil = await getActive(runner, () => 1_000);

    expect(hasil.stale).toBe(true);
    expect(hasil.data).toEqual(emptyActive(1_000));
  });
});
