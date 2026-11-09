"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useStatus } from "@/components/app-shell";
import { QualityRadar } from "@/components/security/quality-radar";
import { StatusBadge, type AppStatus } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/ui/chart-card";
import { PageTabHeader } from "@/components/ui/page-tab-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { RunsPayload, StatusValue } from "@/lib/contracts";
import { dash } from "@/lib/format";
import { fetchRuns } from "@/lib/runs-client";
import { hitungSkor } from "@/lib/score";

const STALE_COPY = "Gagal terhubung ke Jenkins. Menampilkan data terakhir.";

function keBadge(status: StatusValue): AppStatus {
  return status === "passed" || status === "running" || status === "failed" ? status : "unknown";
}

export default function SecurityPage() {
  const { state, loading, failed } = useStatus();
  const [runs, setRuns] = useState<RunsPayload | null>(null);

  useEffect(() => {
    const kontrol = new AbortController();

    fetchRuns(kontrol.signal)
      .then((hasil) => setRuns(hasil.data))
      .catch(() => {
        // Grafik skor tinggal memakai sumbu yang bisa dihitung dari status saja.
      });

    return () => kontrol.abort();
  }, []);

  if (loading && !state) {
    return (
      <section aria-label="Memuat keamanan" aria-busy="true">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-4 h-72" />
      </section>
    );
  }

  if (!state) {
    return (
      <Card className="p-6">
        <p role="alert" className="font-medium text-red-700">
          Status Autore belum tersedia.
        </p>
      </Card>
    );
  }

  const { data, stale } = state;
  const skor = hitungSkor(data, runs);
  const gerbang = data.latest_pipeline;
  const temuan = data.applications.filter((app) => app.security_issues > 0);

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

      <div className="space-y-0">
        <PageTabHeader
          title="Keamanan"
          description="Skor dan temuan dari data pipeline terakhir yang tercatat."
          icon={ShieldCheck}
        />

        <div className="rounded-b-xl sm:rounded-b-2xl bg-white p-5 sm:p-6 pt-4 space-y-4">
          {/* Grid Skor & Gerbang */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <ChartCard title="Skor Pipeline" subtitle="Lima sumbu terukur">
              <QualityRadar score={skor} />
            </ChartCard>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-ink">Gerbang Keamanan</h2>
              <p className="mt-4 font-mono text-2xl font-semibold text-ink">
                {gerbang.gates_passed ?? 0}/{gerbang.gates_total ?? 0}
              </p>
              <p className="mt-2 break-words text-sm text-muted">
                {dash(gerbang.security_summary) === "—"
                  ? "Belum ada ringkasan keamanan yang tercatat."
                  : gerbang.security_summary}
              </p>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-ink">Temuan per Aplikasi</h2>
            </div>
            {temuan.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Tidak ada temuan keamanan tercatat</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-medium">
                        Aplikasi
                      </th>
                      <th scope="col" className="px-5 py-3 font-medium">
                        Temuan
                      </th>
                      <th scope="col" className="px-5 py-3 font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {temuan.map((app) => (
                      <tr key={app.id}>
                        <td className="px-5 py-4">
                          <p className="font-medium text-ink">{dash(app.name)}</p>
                          <p className="font-mono text-xs text-muted">{app.id}</p>
                        </td>
                        <td className="px-5 py-4 text-muted">{app.security_issues} temuan</td>
                        <td className="px-5 py-4">
                          <StatusBadge status={keBadge(app.status)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-xs text-muted">
            Skor dihitung dari data pipeline yang ada; sumbu tanpa data tidak ditampilkan.
          </p>
        </div>
      </div>
    </>
  );
}
