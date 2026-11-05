import { auth, signOut } from "@/auth";
import { DeniedCard } from "@/components/denied-card";

export const metadata = {
  title: "Akses Ditolak — Autore Dashboard",
};

export default async function DeniedPage() {
  const session = await auth();
  const login = (session?.user as { login?: string } | undefined)?.login ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <DeniedCard
        login={login}
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      />
    </main>
  );
}
