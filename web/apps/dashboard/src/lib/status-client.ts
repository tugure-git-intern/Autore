import { isDashboardStatus, parseApiResponse, type ApiStatusResponse } from "./contracts";

/** Same-origin relative URL; Next rewrites /api/* to the loopback Hono adapter. */
export async function fetchDashboardStatus(signal?: AbortSignal): Promise<ApiStatusResponse> {
  const response = await fetch("/api/status", { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`status request failed: ${response.status}`);
  }
  return parseApiResponse(await response.json(), isDashboardStatus);
}