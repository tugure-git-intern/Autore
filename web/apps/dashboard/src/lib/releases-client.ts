import type { FoldResult } from "@autore/contracts";

export type ReleasesPayload = { data: FoldResult; stale: boolean };

/** Endpoint read-only; tidak ada aksi yang dikirim dari klien. */
export async function fetchReleases(app: string, signal?: AbortSignal): Promise<ReleasesPayload> {
  const response = await fetch(`/api/releases?app=${encodeURIComponent(app)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`releases request failed: ${response.status}`);
  }
  const body = (await response.json()) as ReleasesPayload;
  if (!body || typeof body !== "object" || !body.data) {
    throw new Error("releases response tidak dikenal");
  }
  return body;
}
