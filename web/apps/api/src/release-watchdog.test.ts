import { describe, expect, it } from "vitest";
import { putuskanWatchdog } from "./release-watchdog";

describe("putuskanWatchdog", () => {
  it("probe sehat mereset hitungan", () => {
    const hasil = putuskanWatchdog({ gagal_beruntun: 2 }, true);
    expect(hasil).toEqual({ status: { gagal_beruntun: 0 }, aksi: "biarkan" });
  });

  it("dua gagal belum memicu rollback", () => {
    const satu = putuskanWatchdog({ gagal_beruntun: 0 }, false, 3);
    const dua = putuskanWatchdog(satu.status, false, 3);
    expect(dua).toEqual({ status: { gagal_beruntun: 2 }, aksi: "biarkan" });
  });

  it("gagal ketiga memicu rollback sekali", () => {
    const tiga = putuskanWatchdog({ gagal_beruntun: 2 }, false, 3);
    expect(tiga.aksi).toBe("rollback");
    const empat = putuskanWatchdog(tiga.status, false, 3);
    expect(empat.aksi).toBe("biarkan");
  });

  it("rentetan baru setelah pulih bisa memicu lagi", () => {
    const pulih = putuskanWatchdog({ gagal_beruntun: 5 }, true, 3);
    let status = pulih.status;
    let aksi = "biarkan";
    for (let i = 0; i < 3; i += 1) {
      const putusan = putuskanWatchdog(status, false, 3);
      status = putusan.status;
      aksi = putusan.aksi;
    }
    expect(aksi).toBe("rollback");
  });

  it("ambang tidak sah ditolak", () => {
    expect(() => putuskanWatchdog({ gagal_beruntun: 0 }, false, 0)).toThrow();
  });
});
