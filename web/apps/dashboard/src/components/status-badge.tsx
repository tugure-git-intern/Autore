import type { KunciTerjemah } from "@/lib/i18n";
import { useBahasa } from "./bahasa-provider";
import { Badge, type BadgeTone } from "./ui/badge";

export type AppStatus = "passed" | "running" | "failed" | "unknown";

const statuses: Record<AppStatus, { label: KunciTerjemah; tone: BadgeTone }> = {
  passed: { label: "status.lulus", tone: "green" },
  running: { label: "status.berjalan", tone: "amber" },
  failed: { label: "status.gagal", tone: "red" },
  unknown: { label: "status.belumScan", tone: "gray" },
};

export function StatusBadge({ status }: { status: AppStatus }) {
  const { t } = useBahasa();
  const { label, tone } = statuses[status] ?? statuses.unknown;
  return (
    <Badge tone={tone} role={status === "failed" ? "alert" : undefined}>
      {t(label)}
    </Badge>
  );
}
