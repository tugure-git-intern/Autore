export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-gray-100 dark:bg-[var(--bg-sidebar)] ${className}`}
    />
  );
}
