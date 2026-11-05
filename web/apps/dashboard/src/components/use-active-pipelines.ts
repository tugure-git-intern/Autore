import { useCallback, useEffect, useRef, useState } from "react";
import { fetchActive } from "@/lib/active-client";
import type { ActiveCounts, ActivePipeline } from "@/lib/contracts";

/** Data live: sepuluh detik. API sendiri punya cache 5 detik, jadi Jenkins tetap tenang. */
export const INTERVAL_AKTIF_MS = 10_000;

const KOSONG: ActiveCounts = { running: 0, queued: 0 };

type DataAktif = {
  active: ActivePipeline[];
  counts: ActiveCounts;
  /** Permintaan terakhir gagal, atau server menandai datanya basi. */
  stale: boolean;
  memuat: boolean;
};

export interface HasilActive extends DataAktif {
  /** true = data baru masuk. Tidak pernah melempar, supaya aman digabung `Promise.all`. */
  refresh: () => Promise<boolean>;
}

/**
 * Polling endpoint active. Aturan yang dijaga:
 * - satu permintaan menggantung tidak ditumpuk oleh tick berikutnya, dan
 *   `refresh()` pun menunggu permintaan yang sama alih-alih menambah hit;
 * - unmount menghentikan timer dan membatalkan permintaan;
 * - gagal tidak mengosongkan kartu yang sudah ada, hanya menandainya basi.
 */
export function useActivePipelines(intervalMs: number = INTERVAL_AKTIF_MS): HasilActive {
  const [hasil, setHasil] = useState<DataAktif>({
    active: [],
    counts: KOSONG,
    stale: false,
    memuat: true,
  });

  // Jalan keluar untuk tombol Sync: effect pemilik timer, jadi fungsi muatnya
  // disimpan di ref agar bisa dipanggil dari luar effect.
  const jalan = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

  useEffect(() => {
    let hidup = true;
    let sedang: Promise<boolean> | null = null;
    const kontrol = new AbortController();

    const muat = (): Promise<boolean> => {
      if (sedang) return sedang;

      sedang = fetchActive(kontrol.signal)
        .then((respons) => {
          if (hidup) {
            setHasil({
              active: respons.data.active,
              counts: respons.data.counts,
              stale: respons.stale,
              memuat: false,
            });
          }
          return true;
        })
        .catch(() => {
          if (hidup) setHasil((lama) => ({ ...lama, stale: true, memuat: false }));
          return false;
        })
        .finally(() => {
          sedang = null;
        });

      return sedang;
    };

    jalan.current = muat;
    void muat();
    const timer = setInterval(() => void muat(), intervalMs);

    return () => {
      hidup = false;
      jalan.current = () => Promise.resolve(false);
      clearInterval(timer);
      kontrol.abort();
    };
  }, [intervalMs]);

  const refresh = useCallback(() => jalan.current(), []);

  return { ...hasil, refresh };
}
