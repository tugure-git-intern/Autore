import type { ReactNode } from "react";

/** Flat surface: 1px border does the separating, never a shadow. */
export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white dark:border-[#50638b] dark:bg-[#353b43] dark:text-white ${className}`}
    >
      {children}
    </div>
  );
}
