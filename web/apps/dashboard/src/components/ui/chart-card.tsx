import type { ReactNode } from "react";

/** Kartu grafik: border tipis + latar putih, judul dan subjudul kecil. */
export function ChartCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <header
        className={`flex ${subtitle ? "items-start" : "items-center"} justify-between gap-3`}
      >
        <div>
          <h2 className="text-sm font-medium text-gray-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}
