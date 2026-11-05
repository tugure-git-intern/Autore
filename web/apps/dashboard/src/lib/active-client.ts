import type { ApiActiveResponse } from "./contracts";

/** Same-origin relative URL; Next rewrites /api/* to the loopback Hono adapter. */
export async function fetchActive(signal?: AbortSignal): Promise<ApiActiveResponse> {
  const response = await fetch("/api/active", { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`active request failed: ${response.status}`);
  }
  return (await response.json()) as ApiActiveResponse;
}
