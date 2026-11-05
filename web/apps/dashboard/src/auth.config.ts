import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import daftarBerkas from "../../../allowed-users.json";
import { allowedList } from "./lib/allowlist";
import { exposeLogin, signInAllowed, stampLogin } from "./lib/auth-callbacks";

/**
 * Bagian konfigurasi yang aman untuk edge (dipakai `middleware.ts`): tanpa
 * adaptor, tanpa `fs`, tanpa rahasia. Provider ditulis tanpa kredensial —
 * `auth.ts` yang melengkapinya, karena middleware hanya perlu membaca token.
 */
const daftar = allowedList(daftarBerkas as string[], process.env.AUTORE_ALLOWED_USERS);

export const authConfig = {
  providers: [GitHub],
  pages: { signIn: "/login", error: "/403" },
  callbacks: {
    signIn: ({ profile }) => signInAllowed({ profile }, daftar),
    jwt: ({ token, profile }) => stampLogin({ token, profile }),
    session: ({ session, token }) => exposeLogin({ session, token }),
    // Proteksi sebenarnya ada di middleware: di sini `true` supaya halaman
    // /login dan /403 tetap bisa dirender untuk user tanpa sesi.
    authorized: () => true,
  },
} satisfies NextAuthConfig;
