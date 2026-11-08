import type { ReactNode } from "react";
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
  value: ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  hint?: string;
};

export function StatCard({ label, value, icon: Icon, tone = "blue", hint }: StatCardProps) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-5">
      {/* Tile rides the label row; the value keeps one fixed place below it. */}
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm text-muted">{label}</p>
      </div>
      <p className="mt-3 whitespace-nowrap text-xl font-semibold tabular-nums tracking-tight text-ink">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </section>
  );
}
