export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full space-y-6 p-4 sm:p-6"
    >
      <span className="sr-only">Memuat data dashboard...</span>
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-[var(--bg-sidebar)]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="h-28 animate-pulse rounded-xl border border-line bg-canvas p-4" />
        <div className="h-28 animate-pulse rounded-xl border border-line bg-canvas p-4" />
        <div className="h-28 animate-pulse rounded-xl border border-line bg-canvas p-4" />
        <div className="h-28 animate-pulse rounded-xl border border-line bg-canvas p-4" />
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-line bg-canvas p-4" />
    </div>
  );
}
