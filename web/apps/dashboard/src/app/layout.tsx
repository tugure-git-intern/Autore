import type { ReactNode } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import { Navbar } from "@/components/navbar";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata = {
  title: "Autore Dashboard",
  description: "Monitor status CI/CD Autore.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Navbar title="Dashboard" />
            <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-6">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}