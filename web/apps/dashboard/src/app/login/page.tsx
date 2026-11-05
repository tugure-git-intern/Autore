import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { LoginCard } from "@/components/login-card";

export const metadata = {
  title: "Masuk — Autore Dashboard",
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <LoginCard
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/" });
        }}
      />
    </main>
  );
}
