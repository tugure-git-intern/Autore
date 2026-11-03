import type { LucideIcon } from "lucide-react";

export type StatTone = "blue" | "green" | "violet" | "amber";

const tones: Record<StatTone, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-green-50 text-green-600",
  violet: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-600",
};

export type StatCardProps = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: StatTone;
  hint?: string;
};

export function StatCard({ label, value, icon: Icon, tone = "blue", hint }: StatCardProps) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
        </div>
        <span
          aria-hidden="true"
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </section>
  );
}
