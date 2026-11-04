"use client";

import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useStatus } from "@/components/app-shell";
import { PipelineSummary } from "@/components/pipeline/pipeline-summary";
import { StageTimeline } from "@/components/pipeline/stage-timeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const STALE_COPY = "Gagal terhubung ke Jenkins. Menampilkan data terakhir.";

export default function PipelinePage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <PipelineDetail />
    </Suspense>
  );
}

function PipelineDetail() {
  const appId = useSearchParams().get("app") ?? "";
  const { state, loading, failed, reload } = useStatus();

  if (loading && !state) return <LoadingSkeleton />;

  if (failed && !state) {
    return (
      <Card className="p-6">
        <div role="alert">
          <p className="font-medium text-red-700">Status Autore belum tersedia.</p>
          <p className="mt-1 text-sm text-red-600">
            Server tidak mengembalikan data. Coba lagi setelah pipeline berjalan.
          </p>
        </div>
        <Button className="mt-4" onClick={reload}>
          Coba lagi
        </Button>
      </Card>
    );
  }

  if (!state) return <LoadingSkeleton />;

  const { data, stale } = state;
  const app = appId ? data.applications.find((record) => record.id === appId) : undefined;
  const { latest_pipeline: pipeline } = data;

  if (!app) {
    return (
      <Card className="p-6">
        <p className="font-medium text-ink">
          {appId ? `Aplikasi "${appId}" tidak ditemukan.` : "Tidak ada aplikasi yang dipilih."}
        </p>
        <p className="mt-1 text-sm text-muted">
          Pilih aplikasi dari halaman{" "}
          <a href="/applications" className="text-blue-600 hover:underline">
            Aplikasi
          </a>{" "}
          untuk melihat detail pipeline.
        </p>
      </Card>
    );
  }

  return (
    <>
      {stale || failed ? (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {STALE_COPY}
        </div>
      ) : null}

      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Detail Pipeline</h1>
        {/* `latest_pipeline` is one global record, so the app name is context only. */}
        <p className="mt-1 text-sm text-muted">{app.name} · data pipeline terakhir workspace</p>
      </div>

      <div className="mt-4 space-y-4">
        <PipelineSummary pipeline={pipeline} />

        {pipeline.failure_reason.trim() ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {pipeline.failure_reason}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Tahapan Pipeline</h2>
            <div className="mt-4">
              <StageTimeline stages={pipeline.stages} status={pipeline.status} />
            </div>
          </Card>

          <Card className="min-w-0 p-5">
            <h2 id="pipeline-log-title" className="text-sm font-semibold text-ink">
              Detail Log
            </h2>
            <section
              aria-labelledby="pipeline-log-title"
              className="mt-4 rounded-md border border-gray-200 bg-gray-50"
            >
              <pre className="max-h-[26rem] overflow-auto p-4 font-mono text-xs leading-6 text-ink">
                {pipeline.raw_log.length === 0
                  ? "Belum ada log."
                  : pipeline.raw_log.map((line, index) => (
                      <span key={index} className="block whitespace-pre-wrap">
                        {line}
                      </span>
                    ))}
              </pre>
            </section>
          </Card>
        </div>
      </div>
    </>
  );
}

function LoadingSkeleton() {
  return (
    <section aria-label="Memuat pipeline" aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <div className="mt-4 space-y-4">
        <Skeleton className="h-44" />
        <Skeleton className="h-64" />
      </div>
    </section>
  );
}
