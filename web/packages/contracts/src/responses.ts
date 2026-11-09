import { hasExactKeys } from "./guards";
import type { ActivePayload } from "./active";
import type { RunsPayload } from "./runs";
import type { DashboardStatus } from "./status";

/** Amplop `/api/status`: `stale` menandai data terakhir yang baik, bukan data baru. */
export type ApiStatusResponse = { data: DashboardStatus; stale: boolean };

export type ApiRunsResponse = { data: RunsPayload; stale: boolean };

export type ApiActiveResponse = { data: ActivePayload; stale: boolean };

/**
 * Amplop `/api/*` divalidasi ketat: `stale` boolean, `data` sesuai kontrak,
 * tidak ada kunci lain. Payload rusak ditolak di klien, bukan dirender.
 */
export function parseApiResponse<T>(
  body: unknown,
  sah: (value: unknown) => value is T,
): { data: T; stale: boolean } {
  if (
    !hasExactKeys(body, ["data", "stale"]) ||
    typeof body.stale !== "boolean" ||
    !sah(body.data)
  ) {
    throw new Error("invalid api response");
  }
  return { data: body.data, stale: body.stale };
}
