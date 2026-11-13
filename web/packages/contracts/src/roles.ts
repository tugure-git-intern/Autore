// Peran akses dan pemetaan login → role. Satu tempat, dipakai UI (tampilan)
// dan API (gerbang tulis), supaya urutan wewenang tidak pernah berbeda
// antara keduanya.

export type Role = "dev" | "qa" | "admin";

/** Urutan wewenang: dev < qa < admin. Satu-satunya tempat urutan ini ditulis. */
export const ROLE_ORDER: readonly Role[] = ["dev", "qa", "admin"];

/** Login dibandingkan tanpa peduli huruf besar/kecil dan spasi tepi. */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** null = bukan role yang dikenal. Pemanggil WAJIB menolak, bukan default ke admin. */
export function parseRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLE_ORDER as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minimum);
}

/**
 * Baca peta login → role dari nilai apa pun (isi berkas allowlist atau hasil
 * parse JSON). Bentuk lama, larik string, diperlakukan sebagai semua admin.
 * Entri yang role-nya tidak valid DIBUANG (login itu jadi tidak dikenal dan
 * ditolak), bukan diberi default. Nilai yang bentuknya salah → peta kosong,
 * artinya semua ditolak. Fail closed.
 */
export function parseAllowlist(raw: unknown): Map<string, Role> {
  const users = new Map<string, Role>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const login = normalizeLogin(entry);
      if (login !== "") users.set(login, "admin");
    }
    return users;
  }
  if (raw !== null && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const login = normalizeLogin(key);
      const role = parseRole(value);
      if (login === "" || role === null) continue;
      users.set(login, role);
    }
  }
  return users;
}

/**
 * Baca env `AUTORE_ALLOWED_USERS` yang menimpa berkas. Format: daftar dipisah
 * koma, tiap entri `login` atau `login:role`. Tanpa role → admin, supaya nilai
 * lama yang belum ber-role tetap valid. Role tidak dikenal → entri dibuang.
 */
export function parseAllowlistEnv(value: string): Map<string, Role> {
  const users = new Map<string, Role>();
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const pisah = trimmed.lastIndexOf(":");
    const login = normalizeLogin(pisah === -1 ? trimmed : trimmed.slice(0, pisah));
    const role = pisah === -1 ? "admin" : parseRole(trimmed.slice(pisah + 1));
    if (login === "" || role === null) continue;
    users.set(login, role);
  }
  return users;
}

/** Role untuk satu login, atau null bila login tidak dikenal. */
export function roleFor(users: ReadonlyMap<string, Role>, login: string): Role | null {
  return users.get(normalizeLogin(login)) ?? null;
}
