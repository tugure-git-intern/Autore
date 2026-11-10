"use client";

import Link from "next/link";

import { Suspense, useState } from "react";
import { AlertTriangle, Search, Workflow } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStatus } from "@/components/app-shell";
import { EmptyApplications } from "@/components/empty-applications";
import { AppDetail } from "@/components/pipeline/app-detail";
import { AppPicker } from "@/components/pipeline/app-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageTabHeader } from "@/components/ui/page-tab-header";
import { Skeleton } from "@/components/ui/skeleton";
import { filterApps } from "@/lib/filter-apps";
import { pilihAwal } from "@/lib/pilih-app";

const STALE_COPY = "Gagal terhubung ke Jenkins. Menampilkan data terakhir.";

export default function PipelinePage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <PipelineSplit />
    </Suspense>
  );
}

function PipelineSplit() {
  const appId = (useSearchParams().get("app") ?? "").trim();
  const router = useRouter();
  const { state, loading, failed, reload, runs, aktif } = useStatus();
  const [query, setQuery] = useState("");
  // Layar sempit: daftar dan detail bergantian, bukan berdampingan.
  const [lihatDaftar, setLihatDaftar] = useState(false);

  if (loading && !state) return <LoadingSkeleton />;

  if (failed && !state) {
    return (
      <Card className="p-6">
        <div role="alert">
          <p className="font-medium text-red-700 dark:text-red-300">Status Autore belum tersedia.</p>
          <p className="mt-1 text-sm text-red-600 dark:text-red-300">
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
  // `?app=` tetap menang; tanpa itu aplikasi gagal pertama yang dipilih supaya halaman
  // ini tidak pernah jadi layar kosong yang menyuruh user memilih.
  const terpilih = appId
    ? data.applications.find((record) => record.id === appId)
    : pilihAwal(data.applications);
  const daftar = filterApps(data.applications, query, "all");
  const adaTerpilih = Boolean(terpilih);

  const pilih = (id: string) => {
    setLihatDaftar(false);
    router.replace(`/pipeline?app=${encodeURIComponent(id)}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      {stale || failed ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {STALE_COPY}
        </div>
      ) : null}

      {appId && !terpilih ? (
        <Card className="p-6">
          <p className="font-medium text-ink">{`Aplikasi "${appId}" tidak ditemukan.`}</p>
          <p className="mt-1 text-sm text-muted">
            Pilih aplikasi dari daftar di samping, atau buka halaman{" "}
            <Link href="/applications" className="text-blue-600 hover:underline dark:text-blue-300">
              Aplikasi
            </Link>
            .
          </p>
        </Card>
      ) : null}

      <div className="space-y-0">
        <PageTabHeader
          title="Pipeline & Log"
          description="Status eksekusi tahapan CI/CD dan riwayat build."
          icon={Workflow}
        />

        <div className="rounded-b-xl sm:rounded-b-2xl bg-white p-4 sm:p-6 pt-4 dark:bg-[var(--bg-canvas)]">
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside
              data-testid="panel-daftar"
              className={`min-w-0 space-y-3 ${adaTerpilih && !lihatDaftar ? "hidden lg:block" : ""}`}
            >
              {data.applications.length === 0 ? (
                <Card className="p-2">
                  <EmptyApplications />
                </Card>
              ) : (
                <>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-[var(--color-muted)]"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Cari aplikasi..."
                      aria-label="Cari aplikasi"
                      className="h-9 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-sm focus:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)] dark:placeholder:text-[var(--color-muted)]"
                    />
                  </div>
                  <Card className="max-h-[calc(100vh-15rem)] overflow-y-auto p-1">
                    {daftar.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-muted">Tidak ada aplikasi yang cocok.</p>
                    ) : (
                      <AppPicker applications={daftar} terpilih={terpilih?.id} onPilih={pilih} />
                    )}
                  </Card>
                </>
              )}
            </aside>

            <section
              data-testid="panel-detail"
              className={`min-w-0 ${adaTerpilih && !lihatDaftar ? "" : "hidden lg:block"}`}
            >
              {terpilih ? (
                <AppDetail
                  app={terpilih}
                  pipeline={data.latest_pipeline}
                  runs={runs.hasil?.data.runs ?? []}
                  aktif={aktif.active}
                  applications={data.applications}
                  onDaftar={() => setLihatDaftar(true)}
                  onSelesai={reload}
                />
              ) : appId ? null : (
                <Card className="p-2">
                  <EmptyApplications />
                </Card>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <section aria-label="Memuat pipeline" aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    </section>
  );
}
