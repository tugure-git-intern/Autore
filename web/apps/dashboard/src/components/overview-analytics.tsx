"use client";

import { useEffect, useState } from "react";
import { RunDistribution } from "./charts/run-distribution";
import { RunTrends } from "./charts/run-trends";
import { RecentRuns } from "./recent-runs";
import { ChartCard } from "./ui/chart-card";
import { Skeleton } from "./ui/skeleton";
import type { ApiRunsResponse } from "@/lib/contracts";
import { fetchRuns } from "@/lib/runs-client";

const TOTALS_KOSONG = { passed: 0, failed: 0, running: 0 };

/**
 * Grafik + Recent Runs. Kalau `/api/runs` gagal, bagian ini yang kosong —
 * kartu status di atasnya tetap tampil, jadi Jenkins diam bukan halaman blank.
 */
export function OverviewAnalytics() {
  const [hasil, setHasil] = useState<ApiRunsResponse | null>(null);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    const kontrol = new AbortController();

    fetchRuns(kontrol.signal)
      .then(setHasil)
      .catch(() => {
        if (!kontrol.signal.aborted) setGagal(true);
      });

    return () => kontrol.abort();
  }, []);

  const memuat = hasil === null && !gagal;
  const data = hasil?.data;
  const daily = data?.daily ?? [];
  const totals = data?.totals ?? TOTALS_KOSONG;

  return (
    <>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <ChartCard title="Tren 7 Hari" subtitle="Build lulus dan gagal per hari">
            {memuat ? <Skeleton className="h-[220px]" /> : <RunTrends daily={daily} />}
          </ChartCard>
        </div>
        <div className="md:col-span-1">
          <ChartCard title="Distribusi" subtitle="Hasil build dalam 7 hari">
            {memuat ? <Skeleton className="h-[180px]" /> : <RunDistribution totals={totals} />}
          </ChartCard>
        </div>
      </div>

      <div className="mt-4">
        <RecentRuns runs={data?.runs ?? []} stale={hasil?.stale ?? false} />
      </div>
    </>
  );
}
