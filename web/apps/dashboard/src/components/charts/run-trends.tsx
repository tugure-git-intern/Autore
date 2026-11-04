"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS, toTrend } from "@/lib/charts";
import type { DailyPoint } from "@/lib/contracts";

/** Tren build 7 hari terakhir. Hari tanpa build tetap jadi titik nol, bukan celah. */
export function RunTrends({ daily }: { daily: readonly DailyPoint[] }) {
  const titik = toTrend(daily);
  const adaBuild = titik.some((hari) => hari.passed + hari.failed > 0);

  if (!adaBuild) {
    return <p className="text-sm text-gray-500">Belum ada build dalam 7 hari terakhir</p>;
  }

  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={titik} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradPassed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.passed} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_COLORS.passed} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.failed} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_COLORS.failed} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} />
          <YAxis allowDecimals={false} width={28} tick={{ fontSize: 12, fill: "#64748b" }} />
          <Tooltip />
          <Area
            type="monotone"
            dataKey="passed"
            stroke={CHART_COLORS.passed}
            fill="url(#gradPassed)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="failed"
            stroke={CHART_COLORS.failed}
            fill="url(#gradFailed)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}