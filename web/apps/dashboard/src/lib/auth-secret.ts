/**
 * Satu tempat yang membaca rahasia sesi. Fail closed: tanpa rahasia, tidak ada
 * cookie yang bisa diverifikasi, jadi lebih baik gagal saat start daripada
 * melayani request dengan session yang tidak bisa dipercaya.
 */
export function authSecret(): string {
  const rahasia = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!rahasia) {
    throw new Error("AUTH_SECRET/NEXTAUTH_SECRET belum di-set (lihat web/.env.example)");
  }
  return rahasia;
}
