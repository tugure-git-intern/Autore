import { hasSortedKeys } from "./guards";

export type SbomPackageType = "os" | "language";

/** Mirrors `autore sbom --json`. Teks yang tidak tersedia adalah "". */
export type SbomPackage = {
  name: string;
  /** CLI mengirim "" (bukan null) saat SBOM tidak mencatat versinya. */
  version: string;
  type: SbomPackageType;
};

export type SbomPayload = {
  app: string;
  /** `metadata.timestamp` CycloneDX; "" kalau SBOM tidak mencatatnya. */
  generated_at: string;
  source: string;
  total: number;
  packages: SbomPackage[];
};

export type SbomResult =
  | { ok: true; status: 200; data: SbomPayload }
  | { ok: false; status: 400 | 404 | 422 | 503 | 504; error: string };

export function isSbomPayload(value: unknown): value is SbomPayload {
  if (!hasSortedKeys(value, "app,generated_at,packages,source,total")) return false;
  return (
    typeof value.app === "string" &&
    typeof value.generated_at === "string" &&
    typeof value.source === "string" &&
    typeof value.total === "number" &&
    Array.isArray(value.packages) &&
    value.packages.every(isSbomPackage) &&
    value.total === value.packages.length
  );
}

/** Fail-closed: `total` harus sama dengan jumlah paket yang benar-benar dikirim. */
export function validateSbomPayload(raw: unknown): SbomPayload {
  if (!isSbomPayload(raw)) throw new Error("invalid sbom payload");
  return raw;
}

export function isSbomPackage(value: unknown): value is SbomPackage {
  if (!hasSortedKeys(value, "name,type,version")) return false;
  return (
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    (value.type === "os" || value.type === "language")
  );
}