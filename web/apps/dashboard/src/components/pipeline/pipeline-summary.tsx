"use client";

import { useBahasa } from "@/components/bahasa-provider";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { type DashboardStatus, type StatusValue } from "@/lib/contracts";
import { dash } from "@/lib/format";
import type { KunciTerjemah } from "@/lib/i18n";

/** Status → label kamus; tone tetap di sini karena murni presentasi. */
const STATUS: Record<StatusValue, { label: KunciTerjemah; tone: BadgeTone }> = {
  idle: { label: "status.siaga", tone: "gray" },
  running: { label: "status.berjalan", tone: "amber" },
  passed: { label: "status.lulus", tone: "green" },
  failed: { label: "status.gagal", tone: "red" },
  unknown: { label: "status.tidakDiketahui", tone: "gray" },
  pending: { label: "status.menunggu", tone: "gray" },
  skipped: { label: "status.dilewati", tone: "gray" },
};

export function PipelineSummary({ pipeline }: { pipeline: DashboardStatus["latest_pipeline"] }) {
  const { t } = useBahasa();
  const status = STATUS[pipeline.status] ?? STATUS.unknown;
  const securitySummary = pipeline.security_summary.trim();

  return (
    <Card className="min-w-0 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{t("ringkas.judul")}</h2>
        <Badge tone={status.tone}>{t(status.label)}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">{t("detail.commit")}</dt>
          <dd className="break-all font-mono text-ink">{dash(pipeline.commit_sha)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">{t("detail.penulis")}</dt>
          <dd className="break-all font-mono text-ink">{dash(pipeline.author)}</dd>
        </div>
      </dl>
      <div className="mt-4 border-t border-gray-200 pt-4 dark:border-[var(--color-line)]">
        <p className="text-xs uppercase tracking-wide text-muted">{t("ringkas.hasilScan")}</p>
        <p className="mt-1 break-all text-sm text-ink">{securitySummary || t("ringkas.belumScan")}</p>
      </div>
    </Card>
  );
}
