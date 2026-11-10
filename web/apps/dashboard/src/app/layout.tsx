import type { ReactNode } from "react";
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

// Membaca sesi membuat seluruh route dinamis. Itu harga proteksi: halaman yang
// di-prerender tidak punya cara tahu siapa yang memintanya.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    <html
      lang="id"
      className="[--font-google-sans-flex:'Google_Sans_Flex_Variable'] bg-canvas text-ink"
      suppressHydrationWarning
    >
      <head>
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
