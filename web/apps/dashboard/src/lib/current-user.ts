import { auth } from "../auth";

export type SessionUser = {
  login: string;
  name: string;
  image: string | null;
};

/**
 * Satu tempat yang menerjemahkan sesi Auth.js jadi bentuk yang dipakai UI.
 * Login kosong = belum masuk; itu yang membuat UserMenu tidak dirender.
 */
export async function currentUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user as
    | { login?: string; name?: string | null; image?: string | null }
    | undefined;
  return {
    login: user?.login ?? "",
    name: user?.name ?? "",
    image: user?.image ?? null,
  };
}
