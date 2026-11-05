"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiRunsResponse } from "@/lib/contracts";
import { fetchRuns } from "@/lib/runs-client";

export interface HasilRuns {
  hasil: ApiRunsResponse | null;
  /** Penanda basi dari server. Permintaan yang gagal cukup lewat `gagal`. */
  stale: boolean;
  memuat: boolean;
  gagal: boolean;
  /** true = data baru masuk. Tidak pernah melempar, supaya aman digabung `Promise.all`. */
  refresh: () => Promise<boolean>;
}

/**
 * Pemilik `/api/runs`. Dulu fetch-nya menempel di OverviewAnalytics sehingga
 * tombol Sync di topbar tidak punya jalan menyegarkannya; sekarang pemanggilnya
 * provider yang sama dengan pemilik `/api/status`.
 *
 * Aturan yang dijaga: satu permintaan menggantung tidak ditumpuk (refresh saat
 * itu menunggu permintaan yang sama), dan gagal tidak mengosongkan grafik yang
 * sudah tergambar.
 */
export function useRuns(): HasilRuns {
  const [hasil, setHasil] = useState<ApiRunsResponse | null>(null);
  const [gagal, setGagal] = useState(false);
  const sedang = useRef<Promise<boolean> | null>(null);
  const hidup = useRef(true);

  const muat = useCallback((): Promise<boolean> => {
    if (sedang.current) return sedang.current;

    const jalan = fetchRuns()
      .then((respons) => {
        if (hidup.current) {
          setHasil(respons);
          setGagal(false);
        }
        return true;
      })
      .catch(() => {
        if (hidup.current) setGagal(true);
        return false;
      })
      .finally(() => {
        sedang.current = null;
      });

    sedang.current = jalan;
    return jalan;
  }, []);

  useEffect(() => {
    hidup.current = true;
    void muat();
    return () => {
      hidup.current = false;
    };
  }, [muat]);

  return {
    hasil,
    stale: hasil?.stale ?? false,
    memuat: hasil === null && !gagal,
    gagal,
    refresh: muat,
  };
}
