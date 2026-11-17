/**
 * Keputusan watchdog production: murni fungsi dari status gagal beruntun dan
 * hasil probe terbaru, supaya bisa diuji tanpa jaringan.
 */
export type StatusWatchdog = {
  gagal_beruntun: number;
};

export type KeputusanWatchdog = {
  status: StatusWatchdog;
  aksi: "biarkan" | "rollback";
};

/**
 * Probe sehat mereset hitungan. Aksi rollback hanya sekali per rentetan:
 * tepat saat hitungan menyentuh ambang, bukan tiap menit sesudahnya.
 */
export function putuskanWatchdog(
  status: StatusWatchdog,
  sehat: boolean,
  ambang = 3,
): KeputusanWatchdog {
  if (!Number.isInteger(ambang) || ambang < 1) {
    throw new Error("ambang harus bilangan bulat >= 1");
  }
  if (sehat) {
    return { status: { gagal_beruntun: 0 }, aksi: "biarkan" };
  }
  const gagal = status.gagal_beruntun + 1;
  return {
    status: { gagal_beruntun: gagal },
    aksi: gagal === ambang ? "rollback" : "biarkan",
  };
}
