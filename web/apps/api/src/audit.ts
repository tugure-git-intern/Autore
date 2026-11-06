import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Jejak aksi yang tidak meninggalkan commit. `deploy` pada aplikasi yang isinya
 * tidak berubah tidak menulis apa pun ke Git, jadi tanpa baris ini "siapa menekan
 * tombol" hilang sama sekali begitu jumlah penekan tombol lebih dari satu.
 */
export type BarisAudit = {
  login: string;
  email: string;
  action: string;
  target: string;
  exit: number;
};

export type PencatatAudit = (baris: BarisAudit) => void | Promise<void>;

/** Default: `$XDG_STATE_HOME/autore/audit.log` (= `~/.local/state/autore/audit.log`). */
export function jalurAudit(): string {
  return (
    process.env.AUTORE_AUDIT_LOG ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "autore", "audit.log")
  );
}

/**
 * Penulis default: satu baris JSONL ke berkas append-only, plus satu baris ringkas
 * ke stdout supaya ikut terbaca `journalctl --user -u autore-web-api`.
 *
 * Gagal menulis TIDAK menggagalkan aksi: audit itu efek samping, bukan prasyarat
 * deploy — satu-satunya akibatnya adalah pesan error di journal.
 */
export async function catatAudit(baris: BarisAudit, jalur = jalurAudit()): Promise<void> {
  const lengkap = { ts: new Date().toISOString(), ...baris };
  try {
    await mkdir(dirname(jalur), { recursive: true });
    await appendFile(jalur, `${JSON.stringify(lengkap)}\n`, "utf8");
  } catch (error) {
    console.error(`audit log gagal ditulis ke ${jalur}: ${String(error)}`);
  }
  console.log(
    `audit ${lengkap.ts} ${baris.action} ${baris.target} oleh ${baris.login || "tanpa-sesi"} exit=${baris.exit}`,
  );
}
