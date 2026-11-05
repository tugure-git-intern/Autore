export type ActionKind = "deploy" | "scan";

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
};

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim())?.trim() ?? "";
}

/**
 * Memanggil endpoint aksi dan menerjemahkan jawabannya jadi satu pesan siap
 * tampil. Nama aksi dan id aplikasi tetap di sini — frontend tidak pernah
 * mengirim perintah, hanya memilih salah satu aksi yang sudah dikenal.
 */
export async function runAction(action: ActionKind, app?: string): Promise<ActionOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: action === "scan" ? JSON.stringify({ app }) : undefined,
    });
  } catch {
    return { ok: false, message: "Gagal menghubungi server aksi. Cek jaringan lalu coba lagi." };
  }

  if (response.ok) return { ok: true, message: SUCCESS[action] };

  // 401/403 = identitas yang bermasalah, bukan aksi yang gagal: menampilkan
  // pesan saja akan menyisakan UI yang terus gagal sampai halaman dimuat ulang.
  if (response.status === 401 || response.status === 403) {
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
  const detail = payload?.output ? firstLine(payload.output) : "";
  return { ok: false, message: detail ? `${error} — ${detail}` : error };
}
