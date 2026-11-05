import { ShieldOff } from "lucide-react";

/** Halaman untuk user yang login GitHub-nya sah tapi tidak ada di whitelist. */
export function DeniedCard({
  login,
  action,
}: {
  login: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
        <ShieldOff className="h-5 w-5 text-red-600" aria-hidden="true" />
        Akses Ditolak
      </h1>
      <p className="mt-2 text-sm text-muted">
        {login
          ? `Akun GitHub ${login} tidak terdaftar sebagai pengguna dashboard ini.`
          : "Akun GitHub ini tidak terdaftar sebagai pengguna dashboard ini."}
      </p>
      <p className="mt-2 text-sm text-muted">
        Minta admin menambahkan username Anda ke <code>allowed-users.json</code>, lalu coba lagi.
      </p>
      <form action={action} className="mt-6">
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
        >
          Keluar dan masuk dengan akun lain
        </button>
      </form>
    </section>
  );
}
