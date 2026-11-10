import type { ReactNode } from "react";

export type BadgeTone = "green" | "amber" | "red" | "gray" | "blue" | "yellow";

// Latar pastel terang tidak terbaca di kanvas gelap: tiap tone punya pasangan
// gelap (tint 950 + teks 300) dengan kontras di atas 4.5:1 pada #353b43.
const tones: Record<BadgeTone, string> = {
  green: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-muted)]",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-300",
};

export function Badge({
  tone = "gray",
  className = "",
  role,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  role?: string;
  children: ReactNode;
}) {
  return (
    <span
      role={role}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
