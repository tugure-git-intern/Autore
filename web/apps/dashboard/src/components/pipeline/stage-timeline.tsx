import { Check, Loader2, Minus, X } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { StatusValue } from "@/lib/contracts";

/** Canonical Autore stage ids in execution order. Aliases cover the CLI's historical names. */
export const CANONICAL_STAGES = [
  { id: "checkout", label: "Checkout" },
  { id: "scan", label: "Security Scan" },
  { id: "build", label: "Build" },
  { id: "pasang", label: "Push" },
  { id: "periksa", label: "Deploy" },
] as const;

const ALIASES: Record<string, string> = { security_scan: "scan", deploy: "periksa" };

type StageState = "selesai" | "berjalan" | "gagal" | "idle";

const states: Record<StageState, { label: string; tone: BadgeTone; Icon: typeof Check }> = {
  selesai: { label: "selesai", tone: "green", Icon: Check },
  berjalan: { label: "berjalan", tone: "amber", Icon: Loader2 },
  gagal: { label: "gagal", tone: "red", Icon: X },
  idle: { label: "Belum dijalankan", tone: "gray", Icon: Minus },
};

type StageRow = { id: string; label: string; state: StageState };

/**
 * Stages are only ever "recorded" (started) or not. The contract has no per-stage result,
 * so only the last recorded stage inherits failed/running; earlier ones are done.
 */
export function buildStageRows(stages: string[], status: StatusValue): StageRow[] {
  const recorded = stages.map((stage) => stage.trim()).filter(Boolean).map((id) => ALIASES[id] ?? id);
  const canonicalIds = new Set<string>(CANONICAL_STAGES.map((stage) => stage.id));
  const rows: Array<{ id: string; label: string }> = CANONICAL_STAGES.map((stage) => ({ ...stage }));
  for (const id of recorded) {
    if (!canonicalIds.has(id) && !rows.some((row) => row.id === id)) rows.push({ id, label: id });
  }

  const last = recorded.at(-1);
  const lastIndex = last ? rows.findLastIndex((row) => row.id === last) : -1;

  return rows.map((row, index) => {
    if (!recorded.includes(row.id)) return { ...row, state: "idle" };
    if (index !== lastIndex) return { ...row, state: "selesai" };
    if (status === "failed") return { ...row, state: "gagal" };
    if (status === "running") return { ...row, state: "berjalan" };
    return { ...row, state: "selesai" };
  });
}

export function StageTimeline({ stages, status }: { stages: string[]; status: StatusValue }) {
  if (stages.length === 0 && (status === "idle" || status === "unknown")) {
    return <p className="text-sm text-muted">Tidak ada data pipeline untuk ditampilkan.</p>;
  }

  return (
    <ol aria-label="Tahapan pipeline" className="space-y-2">
      {buildStageRows(stages, status).map((row) => {
        const { label, tone, Icon } = states[row.state];
        return (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2"
          >
            <span className="text-sm font-medium text-ink">{row.label}</span>
            <Badge tone={tone} role={row.state === "gagal" ? "alert" : undefined}>
              <Icon
                className={`h-3.5 w-3.5 ${row.state === "berjalan" ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {label}
            </Badge>
          </li>
        );
      })}
    </ol>
  );
}