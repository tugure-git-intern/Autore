"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toSlices } from "@/lib/charts";
import type { RunTotals } from "@/lib/contracts";

/** Donut hasil build. Tiga irisan selalu ada supaya warna legenda tidak berpindah. */
export function RunDistribution({ totals }: { totals: RunTotals }) {
  const irisan = toSlices(totals);
  const total = totals.passed + totals.failed + totals.running;

  return (
    <div>
      <div className="relative h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={irisan}
              dataKey="value"
              nameKey="name"
              innerRadius={54}
              outerRadius={78}
              paddingAngle={2}
              stroke="none"
            >
              {irisan.map((bagian) => (
                <Cell key={bagian.key} fill={bagian.fill} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            data-testid="donut-total"
            className="text-2xl font-semibold text-gray-900 dark:text-white"
          >
            {total}
          </span>
          <span className="text-xs text-gray-500 dark:text-[#c9d1d9]">total build</span>
        </div>
      </div>

      <ul className="mt-4 space-y-1 text-sm">
        {irisan.map((bagian) => (
          <li key={bagian.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-gray-600 dark:text-white">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: bagian.fill }}
                aria-hidden="true"
              />
              {bagian.name}
            </span>
            <span className="font-medium text-gray-900 dark:text-white">{bagian.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
