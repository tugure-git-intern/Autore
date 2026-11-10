import type { ReactNode } from "react";
import { cookies } from "next/headers";
import "@fontsource-variable/google-sans-flex";
import "@fontsource/jetbrains-mono/400.css";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { currentUser } from "@/lib/current-user";
import "./globals.css";

export const metadata = {
  title: "Autore Dashboard",
  description: "Monitor status CI/CD Autore.",
};

// CSS Kritis inlined di <head>: mencegah flash putih (FOUC) saat hard refresh
// (Ctrl+Shift+R) sebelum berkas CSS eksternal selesai diunduh oleh peramban.
const CRITICAL_CSS = `
html { background-color: #fafafa; color-scheme: light; }
html.dark { background-color: #353b43; color-scheme: dark; }
body { background-color: inherit; }
`.trim();

// Skrip inisialisasi tema synchronous di <head>: dieksekusi parser peramban
// sebelum body mulai dirender. Membaca cookie atau localStorage dan memastikan
// elemen <html> langsung memiliki class "dark" sebelum frame pertama dilukis.
const HEAD_THEME_SCRIPT = `
(function() {
  try {
    var m = document.cookie.match(/autore-theme=([^;]+)/);
    var t = m ? decodeURIComponent(m[1]) : localStorage.getItem("autore-theme");
    var d = t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var cl = document.documentElement.classList;
    if (d) {
      if (!cl.contains("dark")) cl.add("dark");
    } else {
      if (cl.contains("dark")) cl.remove("dark");
    }
    if (t) document.cookie = "autore-theme=" + encodeURIComponent(t) + "; path=/; max-age=31536000; SameSite=Lax";
  } catch (e) {}
})();
`.trim();

// Membaca sesi dan cookie membuat seluruh route dinamis. Itu harga proteksi:
// halaman yang di-prerender tidak punya cara tahu tema atau siapa yang memintanya.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [user, cookieStore] = await Promise.all([currentUser(), cookies()]);
  const themeCookie = cookieStore.get("autore-theme")?.value;
  const isDark = themeCookie === "dark";

  return (
    <html
      lang="id"
      className={`[--font-google-sans-flex:'Google_Sans_Flex_Variable'] bg-canvas text-ink ${isDark ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD_THEME_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: CRITICAL_CSS }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <ThemeProvider>
          <AppShell user={user}>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
