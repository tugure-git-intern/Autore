import { hasKeys, isAbsentOr } from "./guards";
import type { ActivePayload } from "./active";
import type { RunsPayload } from "./runs";
import type { DashboardStatus } from "./status";

/** Sebab `stale` di `/api/status`: CLI gagal jalan vs. stdout-nya ditolak kontrak. */
export type StaleReason = "invalid_payload" | "command_failed";

const STALE_REASONS = ["invalid_payload", "command_failed"] as const;

export function isStaleReason(value: unknown): value is StaleReason {
  return typeof value === "string" && (STALE_REASONS as readonly string[]).includes(value);
}

/** Amplop `/api/status`: `stale` menandai data terakhir yang baik, bukan data baru. */
export type ApiStatusResponse = {
  data: DashboardStatus;
  stale: boolean;
  stale_reason?: StaleReason;
};

export type ApiRunsResponse = { data: RunsPayload; stale: boolean };

export type ApiActiveResponse = { data: ActivePayload; stale: boolean };

/**
 * Amplop `/api/*` divalidasi ketat: `stale` boolean, `data` sesuai kontrak,
 * `stale_reason` opsional khusus status, tidak ada kunci lain. Payload rusak
 * ditolak di klien, bukan dirender.
 */
export function parseApiResponse<T>(
  body: unknown,
  sah: (value: unknown) => value is T,
): { data: T; stale: boolean; stale_reason?: StaleReason } {
  if (
    !hasKeys(body, ["data", "stale"], ["stale_reason"]) ||
    typeof body.stale !== "boolean" ||
    !isAbsentOr(body.stale_reason, isStaleReason) ||
    !sah(body.data)
  ) {
    throw new Error("invalid api response");
  }
  const hasil: { data: T; stale: boolean; stale_reason?: StaleReason } = {
    data: body.data,
    stale: body.stale,
  };
  if (isStaleReason(body.stale_reason)) hasil.stale_reason = body.stale_reason;
  return hasil;
}
