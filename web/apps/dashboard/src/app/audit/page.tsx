"use client";

import { useEffect, useState } from "react";
import { AlertCircle, History, RefreshCw } from "lucide-react";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { PageTabHeader } from "@/components/ui/page-tab-header";
import { BATAS_AUDIT, fetchAuditLog, type AuditEntry } from "@/lib/audit-client";

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuditLog();
      setEntries(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan saat memuat log audit.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetchAuditLog()
      .then((res) => {
        if (active) {
          setEntries(res.data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Terjadi kesalahan saat memuat log audit.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-0">
      {/* Header Tab Card ala Google Cloud Console */}
      <PageTabHeader
        title="Audit Log"
        description="Jejak audit aktivitas operasional dan pipeline DevSecOps secara kronologis."
        icon={History}
        action={
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)] dark:hover:bg-[var(--bg-canvas)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Muat Ulang
          </button>
        }
      />

      {/* Lembaran Konten Putih yang menyatu tanpa celah */}
      <div className="rounded-b-xl sm:rounded-b-2xl bg-white p-5 sm:p-6 pt-4 dark:bg-[var(--bg-canvas)]">
        {/* State Error */}
        {error ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-300" />
            <div className="text-sm">
              <p className="font-semibold">Gagal memuat data audit log</p>
              <p className="mt-1 text-xs text-rose-700 dark:text-rose-200">{error}</p>
              <button
                type="button"
                onClick={loadData}
                className="mt-3 rounded border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:bg-transparent dark:text-rose-200 dark:hover:bg-rose-950"
              >
                Coba Lagi
              </button>
            </div>
          </div>
        ) : null}

        {/* State Loading Skeleton */}
        {loading && !error ? (
          <div className="space-y-4">
            <div className="h-10 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-[var(--bg-sidebar)]" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]"
                >
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-[var(--bg-sidebar)]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-[var(--bg-sidebar)]" />
                    <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100 dark:bg-[var(--bg-sidebar)]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Content Loaded */}
        {!loading && !error ? (
          <>
            <AuditTimeline entries={entries} />
            {/* Rute hanya mengirim baris terakhir; tanpa catatan ini pembaca bisa
                menyimpulkan log-nya memang cuma segitu. */}
            {entries.length > 0 ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-[var(--color-muted)]">
                Menampilkan maksimal {BATAS_AUDIT} aktivitas terbaru.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
