"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "next-themes";
import { CHART_COLORS, toRadar } from "@/lib/charts";
import type { Score } from "@/lib/score";

/** Radar lima sumbu terukur. Sumbu tanpa data dibuang, bukan digambar sebagai nol. */
export function QualityRadar({ score }: { score: Score }) {
  const { theme, resolvedTheme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";
  const gridColor = isDark ? "#50638b" : CHART_COLORS.grid;
  const axisStroke = isDark ? "#50638b" : "#64748b";
  const tickColor = isDark ? "#ffffff" : "#64748b";

  const sumbu = toRadar(score);

  if (sumbu.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-white">Belum ada data untuk dinilai</p>;
  }

  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={sumbu} outerRadius="72%">
          <PolarGrid stroke={gridColor} />
          <PolarAngleAxis
            dataKey="axis"
            stroke={axisStroke}
            tick={{ fontSize: 12, fill: tickColor }}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="value" stroke="#0f766e" fill="#14b8a6" fillOpacity={0.25} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
