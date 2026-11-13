import { parseRole, type Role } from "@autore/contracts";
import { auth } from "../auth";

export type SessionUser = {
  login: string;
  name: string;
  image: string | null;
  /** Hanya untuk tampilan; API menghitung ulang role tiap request tulis. */
  role?: Role | null;
};

/**
 * Satu tempat yang menerjemahkan sesi Auth.js jadi bentuk yang dipakai UI.
 * Login kosong = belum masuk; itu yang membuat UserMenu tidak dirender.
 * Role null (token lama tanpa role) dibaca UI sebagai tanpa wewenang.
 */
export async function currentUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user as
    | { login?: string; name?: string | null; image?: string | null; role?: unknown }
    | undefined;
  return {
    login: user?.login ?? "",
    name: user?.name ?? "",
    image: user?.image ?? null,
    role: parseRole(user?.role),
  };
}