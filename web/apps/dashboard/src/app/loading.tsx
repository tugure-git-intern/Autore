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
        <div className="h-28 animate-pulse rounded-xl border border-gray-100 bg-white p-4 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]" />
        <div className="h-28 animate-pulse rounded-xl border border-gray-100 bg-white p-4 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]" />
        <div className="h-28 animate-pulse rounded-xl border border-gray-100 bg-white p-4 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]" />
        <div className="h-28 animate-pulse rounded-xl border border-gray-100 bg-white p-4 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]" />
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-gray-100 bg-white p-4 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]" />
    </div>
  );
}
