import { Badge, type BadgeTone } from "./ui/badge";

export type AppStatus = "passed" | "running" | "failed" | "unknown";

const statuses: Record<AppStatus, { label: string; tone: BadgeTone }> = {
  passed: { label: "Lulus", tone: "green" },
  running: { label: "Berjalan", tone: "amber" },
  failed: { label: "Gagal", tone: "red" },
  unknown: { label: "Belum ada hasil scan", tone: "gray" },
};

export function StatusBadge({ status }: { status: AppStatus }) {
  const { label, tone } = statuses[status] ?? statuses.unknown;
  return (
    <Badge tone={tone} role={status === "failed" ? "alert" : undefined}>
      {label}
    </Badge>
  );
}
