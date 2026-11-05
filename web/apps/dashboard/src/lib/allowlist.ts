/**
 * Whitelist akses: satu daftar, dua sumber. `allowed-users.json` adalah
 * sumber kebenaran; `AUTORE_ALLOWED_USERS` (dipisah koma) menimpanya kalau
 * tidak kosong — supaya operator bisa mencabut akses tanpa mengubah berkas.
 *
 * GitHub username tidak case-sensitive, jadi setiap nama dinormalkan sebelum
 * dibandingkan. Perbandingan tanpa normalisasi = whitelist "Alif" menolak
 * login "alif".
 */

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function parseAllowedUsers(raw: string | undefined): string[] {
  if (!raw) return [];
  const hasil: string[] = [];
  for (const bagian of raw.split(",")) {
    const nama = normalizeLogin(bagian);
    if (nama && !hasil.includes(nama)) hasil.push(nama);
  }
  return hasil;
}

/** Env yang berisi sesuatu menimpa berkas; env kosong/kosong-spasi jatuh ke berkas. */
export function allowedList(
  fileList: readonly string[],
  envValue: string | undefined,
): string[] {
  const dariEnv = parseAllowedUsers(envValue);
  if (dariEnv.length > 0) return dariEnv;
  return fileList.map(normalizeLogin).filter((nama) => nama !== "");
}

/**
 * Login kosong tidak pernah lolos. Daftarnya dinormalkan di sini juga supaya
 * daftar mentah (berkas yang ditulis manusia, env yang di-export manual)
 * tidak pernah jadi celah "salah huruf besar = ditolak".
 */
export function isAllowed(login: string, list: readonly string[]): boolean {
  const nama = normalizeLogin(login);
  if (nama === "") return false;
  return list.some((kandidat) => normalizeLogin(kandidat) === nama);
}
