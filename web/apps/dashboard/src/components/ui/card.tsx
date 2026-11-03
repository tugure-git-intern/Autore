import type { ReactNode } from "react";

/** Flat surface: 1px border does the separating, never a shadow. */
export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-lg border border-gray-200 bg-white ${className}`}>{children}</div>;
}
