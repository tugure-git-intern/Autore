import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import daftarBerkas from "../../../allowed-users.json";
import { authConfig } from "./auth.config";
import { authSecret } from "./lib/auth-secret";
import { allowlistMap, isAllowed } from "./lib/allowlist";

const daftar = allowlistMap(daftarBerkas, process.env.AUTORE_ALLOWED_USERS);
const TANPA_SESI = new Set(["/login", "/403"]);

const { auth } = NextAuth({ ...authConfig, secret: authSecret(), trustHost: true });

/**
 * Dua pesan berbeda disengaja: tanpa sesi -> /login (bisa diperbaiki sendiri),
 * login sah tapi di luar whitelist -> /403 (harus minta admin). `/api/*`
 * sengaja tidak disaring di sini — boundary API dipegang Hono yang menjawab
 * 401 JSON, bukan redirect HTML yang membingungkan `fetch()`.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (TANPA_SESI.has(pathname) || pathname.startsWith("/api/auth")) return NextResponse.next();

  const login = (req.auth?.user as { login?: string } | undefined)?.login ?? "";
  if (!login) {
    const tujuan = new URL("/login", req.nextUrl.origin);
    if (pathname !== "/") tujuan.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(tujuan);
  }

  if (!isAllowed(login, daftar)) {
    return NextResponse.redirect(new URL("/403", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  // Berkas statis dari public/ harus lolos tanpa sesi: middleware ini mengalihkan
  // apa pun yang tidak dikecualikan ke /login, jadi logo sidebar dijawab 307 dan
  // tampil rusak di halaman login.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|svg|webp|ico)$).*)"],
};
