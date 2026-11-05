import { useEffect, useState } from "react";
import { fetchActive } from "@/lib/active-client";
import type { ActiveCounts, ActivePipeline } from "@/lib/contracts";

/** Data live: sepuluh detik. API sendiri punya cache 5 detik, jadi Jenkins tetap tenang. */
export const INTERVAL_AKTIF_MS = 10_000;

const KOSONG: ActiveCounts = { running: 0, queued: 0 };

export interface HasilActive {
  active: ActivePipeline[];
  counts: ActiveCounts;
  /** Permintaan terakhir gagal, atau server menandai datanya basi. */
  stale: boolean;
  memuat: boolean;
}

/**
 * Polling endpoint active. Aturan yang dijaga:
 * - satu permintaan menggantung tidak ditumpuk oleh tick berikutnya;
 * - unmount menghentikan timer dan membatalkan permintaan;
 * - gagal tidak mengosongkan kartu yang sudah ada, hanya menandainya basi.
 */
export function useActivePipelines(intervalMs: number = INTERVAL_AKTIF_MS): HasilActive {
  const [hasil, setHasil] = useState<HasilActive>({
    active: [],
    counts: KOSONG,
    stale: false,
    memuat: true,
  });

  useEffect(() => {
    let hidup = true;
    let sedang = false;
    const kontrol = new AbortController();

    const muat = async () => {
      if (sedang) return;
      sedang = true;
      try {
        const respons = await fetchActive(kontrol.signal);
        if (!hidup) return;
        setHasil({
          active: respons.data.active,
          counts: respons.data.counts,
          stale: respons.stale,
          memuat: false,
        });
      } catch {
        if (!hidup) return;
        setHasil((lama) => ({ ...lama, stale: true, memuat: false }));
      } finally {
        sedang = false;
      }
    };

    void muat();
    const timer = setInterval(() => void muat(), intervalMs);

    return () => {
      hidup = false;
      clearInterval(timer);
      kontrol.abort();
    };
  }, [intervalMs]);

  return hasil;
}
