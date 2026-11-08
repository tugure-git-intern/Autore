"use client";

import { ActivePipelines } from "./active-pipelines";
import { useStatus } from "./app-shell";
import { RunDistribution } from "./charts/run-distribution";
import { RunTrends } from "./charts/run-trends";
import { RecentRuns } from "./recent-runs";
import { ChartCard } from "./ui/chart-card";
import { Skeleton } from "./ui/skeleton";

const TOTALS_KOSONG = { passed: 0, failed: 0, running: 0 };

/**
 * Pipeline aktif + grafik + Recent Runs. Dua sumber dipisah: `/api/active` gagal
 * tidak mengosongkan grafik, dan `/api/runs` gagal tidak mengosongkan kartu
 * pipeline — Jenkins diam bukan halaman blank.
 *
 * Keduanya dibaca dari provider, bukan di-fetch di sini: itulah yang membuat
 * tombol Sync di topbar bisa menyegarkan halaman ini tanpa reload.
 */
export function OverviewAnalytics() {
  const { runs: hasilRuns, aktif } = useStatus();

  const data = hasilRuns.hasil?.data;
  const daily = data?.daily ?? [];
  const totals = data?.totals ?? TOTALS_KOSONG;

  return (
    <>
      <div className="mt-6">
        <ActivePipelines active={aktif.active} counts={aktif.counts} stale={aktif.stale} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <ChartCard title="Tren 7 Hari" subtitle="Build lulus dan gagal per hari">
            {hasilRuns.memuat ? <Skeleton className="h-[220px]" /> : <RunTrends daily={daily} />}
          </ChartCard>
        </div>
        <div className="md:col-span-1">
          <ChartCard title="Distribusi" subtitle="Hasil build dalam 7 hari">
            {hasilRuns.memuat ? <Skeleton className="h-[180px]" /> : <RunDistribution totals={totals} />}
          </ChartCard>
        </div>
      </div>

      <div className="mt-4">
        <RecentRuns runs={data?.runs ?? []} stale={hasilRuns.stale} />
      </div>
    </>
  );
}
