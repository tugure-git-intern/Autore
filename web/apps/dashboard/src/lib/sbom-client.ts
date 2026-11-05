import type { SbomPayload } from "./contracts";

/**
 * Same-origin relative URL; Next rewrites /api/* ke adapter Hono loopback.
 * `null` = aplikasi ini belum punya SBOM (404 dari API) — bukan kesalahan, jadi
 * halaman yang memutuskan tampilannya, bukan `throw`.
 */
export async function fetchSbom(app: string, signal?: AbortSignal): Promise<SbomPayload | null> {
  const response = await fetch(`/api/sbom/${encodeURIComponent(app)}`, {
    cache: "no-store",
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`sbom request failed: ${response.status}`);
  }
  return (await response.json()) as SbomPayload;
}
