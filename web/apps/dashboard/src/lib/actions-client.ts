export type ActionKind = "deploy" | "scan" | "remove";

export interface ActionOutcome {
  ok: boolean;
  message: string;
  /** Diisi kalau server menolak karena sesi; pemanggil yang memindahkan halaman. */
  redirectTo?: string;
}

/** Satu tempat yang tahu ke mana sesi yang ditolak harus pergi. */
export function goToLogin(redirectTo: string): void {
  window.location.assign(redirectTo);
}

const SUCCESS: Record<ActionKind, string> = {
  deploy: "Deploy terkirim, build Jenkins sedang berjalan.",
  scan: "Scan keamanan selesai tanpa temuan.",
  remove: "Aplikasi dihapus dari server. Repo GitHub tidak disentuh.",
};

/** Dipakai juga oleh quick-start-client: satu cara membaca baris pesan CLI. */
export function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim())?.trim() ?? "";
}

/** Baris tidak-kosong terakhir: ringkasan langkah gagal CLI ada di paling akhir. */
function lastLine(text: string): string {
  const lines = text.split("\n").filter((line) => line.trim());
  return lines[lines.length - 1]?.trim() ?? "";
}

/**
 * Memanggil endpoint aksi dan menerjemahkan jawabannya jadi satu pesan siap
 * tampil. Nama aksi dan id aplikasi tetap di sini — frontend tidak pernah
 * mengirim perintah, hanya memilih salah satu aksi yang sudah dikenal.
 *
 * `konfirmasi` hanya ikut di body aksi yang meminta ketik-ulang nama (remove);
 * aksi lain tetap kirim `{ app }` saja supaya kontraknya tak berubah.
 */
export async function runAction(
  action: ActionKind,
  app: string,
  konfirmasi?: string,
): Promise<ActionOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Id aplikasi selalu ikut di body: server tidak punya target cadangan, jadi
      // aksi tanpa app akan dijawab 400, bukan menjalankan aplikasi lain.
      body: JSON.stringify(konfirmasi !== undefined ? { app, konfirmasi } : { app }),
    });
  } catch {
    return { ok: false, message: "Gagal menghubungi server aksi. Cek jaringan lalu coba lagi." };
  }

  if (response.ok) return { ok: true, message: SUCCESS[action] };

  // 401 = sesi yang bermasalah, bukan aksi yang gagal: menampilkan pesan saja
  // akan menyisakan UI yang terus gagal sampai halaman dimuat ulang. 403 beda:
  // itu penolakan izin dengan pesan jelas dari server (mis. butuh role admin),
  // jadi jatuh ke jalur payload di bawah supaya pesannya tampil tanpa redirect.
  if (response.status === 401) {
    return {
      ok: false,
      message: "Sesi Anda sudah berakhir. Silakan login ulang.",
      redirectTo: "/login",
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: string; output?: string }
    | null;
  const error = payload?.error ?? `Server menolak aksi (HTTP ${response.status}).`;
  // Remove mencetak judul dulu lalu ringkasan langkah gagal di akhir: ambil
  // baris terakhir supaya user tahu apa yang belum dibuang. Aksi lain (scan,
  // deploy) tetap pakai baris pertama.
  const detail = payload?.output
    ? action === "remove"
      ? lastLine(payload.output)
      : firstLine(payload.output)
    : "";
  return { ok: false, message: detail ? `${error} — ${detail}` : error };
}
