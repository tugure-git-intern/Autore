import type { ApplicationRecord } from "./contracts";

export type StatusFilter = "all" | "passed" | "failed" | "unknown";

/** Satu tempat untuk pencarian + filter halaman Aplikasi; urutan asli dipertahankan. */
export function filterApps(
  apps: readonly ApplicationRecord[],
  query: string,
  status: StatusFilter,
): ApplicationRecord[] {
  const q = query.trim().toLowerCase();

  return apps.filter((app) => {
    if (status !== "all" && app.status !== status) return false;
    if (!q) return true;
    return app.id.toLowerCase().includes(q) || app.name.toLowerCase().includes(q);
  });
}
