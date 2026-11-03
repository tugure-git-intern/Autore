import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { DashboardStatus, StatusValue } from "@/lib/contracts";
import { dash } from "@/lib/contracts";

const labels: Record<StatusValue, { label: string; tone: BadgeTone }> = {
  idle: { label: "Siaga", tone: "gray" },
  running: { label: "Berjalan", tone: "amber" },
  passed: { label: "Lulus", tone: "green" },
  failed: { label: "Gagal", tone: "red" },
  unknown: { label: "Tidak diketahui", tone: "gray" },
  pending: { label: "Menunggu", tone: "gray" },
  skipped: { label: "Dilewati", tone: "gray" },
};

export function PipelineSummary({ pipeline }: { pipeline: DashboardStatus["latest_pipeline"] }) {
  const status = labels[pipeline.status] ?? labels.unknown;
  const securitySummary = pipeline.security_summary.trim();

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Ringkasan Pipeline</h2>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Commit</dt>
          <dd className="font-mono text-ink">{dash(pipeline.commit_sha)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Author</dt>
          <dd className="font-mono text-ink">{dash(pipeline.author)}</dd>
        </div>
      </dl>
      <div className="mt-4 border-t border-gray-200 pt-4">
        <p className="text-xs uppercase tracking-wide text-muted">Hasil Security Scan</p>
        <p className="mt-1 text-sm text-ink">
          {securitySummary || "Belum ada hasil scan"}
        </p>
      </div>
    </Card>
  );
}