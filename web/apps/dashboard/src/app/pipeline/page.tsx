"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, ScrollText } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { ApiStatusResponse } from "@/lib/contracts";
import { fetchDashboardStatus } from "@/lib/status-client";
import { LogModal } from "@/components/pipeline/log-modal";
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
  const [state, setState] = useState<ApiStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (background: boolean) => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fetchDashboardStatus(next.signal);
      if (!next.signal.aborted) {
        setState(result);
        setFailed(false);
      }
    } catch (error) {
      if (!next.signal.aborted && (error as Error)?.name !== "AbortError") setFailed(true);
    } finally {
      if (!next.signal.aborted) {
        if (background) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => controller.current?.abort();
  }, [load]);

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
        <Button className="mt-4" onClick={() => void load(false)}>
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Pipeline</h1>
          <p className="mt-1 text-sm text-muted">{app.name}</p>
        </div>
        <Button onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Sync
        </Button>
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

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Tahapan Pipeline</h2>
          <div className="mt-4">
            <StageTimeline stages={pipeline.stages} status={pipeline.status} />
          </div>
        </Card>

        <Button onClick={() => setOpen(true)}>
          <ScrollText className="h-4 w-4" aria-hidden="true" />
          Lihat Log Lengkap
        </Button>
      </div>

      <LogModal lines={pipeline.raw_log} open={open} onOpenChange={setOpen} />
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