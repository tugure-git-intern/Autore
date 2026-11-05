import type { ReactNode } from "react";

export type BadgeTone = "green" | "amber" | "red" | "gray" | "blue" | "yellow";

const tones: Record<BadgeTone, string> = {
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-700",
  yellow: "bg-yellow-100 text-yellow-700",
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
