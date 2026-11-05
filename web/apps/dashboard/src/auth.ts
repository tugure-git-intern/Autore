import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { authConfig } from "./auth.config";
import { authSecret } from "./lib/auth-secret";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: authSecret(),
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  // Kredensial diisi eksplisit: provider GitHub di Auth.js tidak membaca env
  // sendiri, jadi `GITHUB_ID` kosong = login gagal tanpa pesan yang jelas.
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID ?? process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET ?? process.env.AUTH_GITHUB_SECRET,
    }),
  ],
});
