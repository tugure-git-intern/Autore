import type { ReactNode } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import { AppShell } from "@/components/app-shell";
import { currentUser } from "@/lib/current-user";
import "./globals.css";

export const metadata = {
  title: "Autore Dashboard",
  description: "Monitor status CI/CD Autore.",
};

// Membaca sesi membuat seluruh route dinamis. Itu harga proteksi: halaman yang
// di-prerender tidak punya cara tahu siapa yang memintanya.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="id">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
