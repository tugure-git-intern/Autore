/** Bentuk objek biasa: bukan null, bukan larik. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Kunci wajib harus ada; kunci di luar daftar (wajib + opsional) ditolak. */
export function hasKeys(
  value: unknown,
  wajib: string[],
  opsional: string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const kunci = Object.keys(value);
  return (
    wajib.every((key) => Object.hasOwn(value, key)) &&
    kunci.every((key) => wajib.includes(key) || opsional.includes(key))
  );
}

/** Bentuk ketat: jumlah kunci sama persis dan semuanya ada (payload runs/active). */
export function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Bentuk SBOM: kunci diurut lalu dibandingkan sebagai satu daftar tetap. */
export function hasSortedKeys(value: unknown, daftar: string): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).sort().join(",") === daftar;
}

/** Bilangan bulat >= 0. Nilai negatif, pecahan, NaN, dan string ditolak. */
export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Snapshot lama belum membawa field ini; yang ada harus tetap berbentuk benar. */
export function isAbsentOr<T>(value: unknown, sah: (value: unknown) => value is T): boolean {
  return value === undefined || sah(value);
}