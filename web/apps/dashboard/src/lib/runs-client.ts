import type { ApiRunsResponse } from "./contracts";

/** Same-origin relative URL; Next rewrites /api/* to the loopback Hono adapter. */
export async function fetchRuns(signal?: AbortSignal): Promise<ApiRunsResponse> {
  const response = await fetch("/api/runs", { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`runs request failed: ${response.status}`);
  }
  return (await response.json()) as ApiRunsResponse;
}