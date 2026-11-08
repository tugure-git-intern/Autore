import type { ActiveCounts, ActivePipeline } from "@/lib/contracts";
import { dash } from "@/lib/contracts";
import { inisial, shortSha } from "@/lib/format";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { ChartCard } from "./ui/chart-card";
import { CheckCircle2, GitBranch, RefreshCw, Zap } from "lucide-react";

const STATUS: Record<ActivePipeline["status"], { label: string; tone: "blue" | "yellow" }> = {
  running: { label: "Berjalan", tone: "blue" },
  queued: { label: "Menunggu", tone: "yellow" },
};

/**
 * Kartu pipeline live. Presentational: tanpa fetch dan tanpa timer sendiri, supaya
 * bisa diuji tanpa menunggu jaringan. Polling-nya milik `useActivePipelines`.
 */
export function ActivePipelines({
  active,
  counts,
  stale = false,
  onRefresh,
}: {
  active: readonly ActivePipeline[];
  counts: ActiveCounts;
  stale?: boolean;
  onRefresh?: () => void;
}) {
  const total = counts.running + counts.queued;

  return (
    <ChartCard
      title="Active Pipelines"
      subtitle="Pipeline yang sedang berjalan atau menunggu"
      action={
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 text-green-700">
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            {total} berjalan atau menunggu
          </span>
          {stale ? <span className="text-amber-600">data terakhir</span> : null}
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            <RefreshCw className="h-3 w-3 text-gray-500" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      }
    >
      {active.length === 0 ? (
        <div
          data-testid="active-pipelines-empty"
          className="flex flex-col items-center justify-center py-12 text-center"
        >
          <div className="mb-4 rounded-full bg-green-50 p-3">
            <CheckCircle2 className="h-12 w-12 text-green-500" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Semua Pipeline Selesai</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Tidak ada pipeline yang sedang berjalan atau menunggu. Saat workflow dimulai, statusnya
            akan muncul di sini secara real-time.
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-6 inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900"
          >
            <RefreshCw className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {active.map((p) => {
            const { label, tone } = STATUS[p.status] ?? STATUS.queued;
            return (
              <div key={`${p.app}-${p.number}`} data-testid="pipeline-card">
                <Card className="relative flex h-full flex-col gap-2 overflow-hidden p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{p.app}</span>
                    {p.number > 0 ? (
                      <span className="text-xs text-gray-500">#{p.number}</span>
                    ) : null}
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                    {dash(p.branch)}
                  </span>

                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-blue-600 hover:underline"
                  >
                    {shortSha(p.commit_sha)}
                  </a>

                  {p.author ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-medium text-gray-600">
                        {inisial(p.author)}
                      </span>
                      <span className="truncate text-xs text-gray-600">{dash(p.author)}</span>
                    </div>
                  ) : null}

                  <div>
                    <Badge tone={tone}>{label}</Badge>
                  </div>

                  {p.status === "running" ? (
                    <div
                      data-testid="progress-indeterminate"
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-blue-500/15 motion-reduce:bg-blue-500"
                    >
                      <div
                        data-testid="progress-comet"
                        className="absolute inset-y-0 left-0 flex w-2/3 motion-safe:animate-[geser_1.6s_linear_infinite] motion-reduce:hidden"
                      >
                        <div
                          data-testid="progress-band-belakang"
                          className="h-full w-1/2 rounded-l-full bg-blue-400/50"
                        />
                        <div
                          data-testid="progress-band-depan"
                          className="h-full w-1/2 rounded-r-full bg-blue-500"
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      data-testid="antre-statis"
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-1 bg-yellow-400/70"
                    />
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}
