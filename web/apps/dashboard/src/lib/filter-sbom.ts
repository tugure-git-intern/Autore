import type { SbomPackage } from "./contracts";

/** Satu tempat untuk pencarian tabel SBOM; urutan asli dari CLI dipertahankan. */
export function filterPackages(packages: readonly SbomPackage[], query: string): SbomPackage[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...packages];

  return packages.filter(
    (paket) => paket.name.toLowerCase().includes(q) || paket.version.toLowerCase().includes(q),
  );
}
