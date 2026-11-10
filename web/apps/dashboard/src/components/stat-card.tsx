import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type StatTone = "blue" | "green" | "violet" | "amber";

const tones: Record<StatTone, string> = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300",
  green: "bg-green-50 text-green-600 dark:bg-green-950/60 dark:text-green-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300",
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
    <section className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-5 dark:border-[#50638b] dark:bg-[#353b43]">
      {/* Tile rides the label row; the value keeps one fixed place below it. */}
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm text-muted dark:text-white">{label}</p>
      </div>
      <p className="mt-3 whitespace-nowrap text-xl font-semibold tabular-nums tracking-tight text-ink dark:text-white">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted dark:text-[#c9d1d9]">{hint}</p> : null}
    </section>
  );
}
