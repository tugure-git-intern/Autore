import { appendFile, readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";

/**
 * `registry.tsv` adalah satu-satunya daftar aplikasi yang dibaca dashboard
 * (`autore status` → `/api/status`). Perintah `autore quick-start` tidak pernah
 * menulisnya — hanya alur dashboard Rust lama yang menulis — jadi aplikasi yang
 * dibuat lewat web harus dicatat di sini supaya kelihatan di daftar aplikasi.
 *
 * Format baris mengikuti writer Rust (`cli/src/serve.rs`): `nama<TAB>app<TAB>deploy`,
 * port app selalu 8000 (jaringan container terpisah), port deploy unik di host.
 */

export interface BarisRegistry {
  nama: string;
  app: number;
  deploy: number;
}

const APP_PORT = 8000;
const DEPLOY_AWAL = 8003;
const DEPLOY_AKHIR = 8200;
const LANGKAH = 10;

/** Baris rusak dilewati: file catatan tidak boleh menggagalkan aksi. */
export function bacaRegistry(isi: string): BarisRegistry[] {
  const baris: BarisRegistry[] = [];
  for (const teks of isi.split("\n")) {
    const bagian = teks.split("\t");
    if (bagian.length < 3) continue;
    const app = Number(bagian[1]);
    const deploy = Number(bagian[2]);
    if (!bagian[0] || !Number.isInteger(app) || !Number.isInteger(deploy)) continue;
    baris.push({ nama: bagian[0], app, deploy });
  }
  return baris;
}

/** Port deploy bebas berikutnya: 8003, 8013, ... (langkah 10, sama seperti CLI). */
export function portDeployBerikut(terpakai: number[], bebas: (port: number) => boolean): number {
  let deploy = DEPLOY_AWAL;
  while (deploy < DEPLOY_AKHIR) {
    if (!terpakai.includes(deploy) && bebas(deploy)) break;
    deploy += LANGKAH;
  }
  return deploy;
}

/** Benar kalau tidak ada yang sedang listen di port itu (127.0.0.1). */
export function portBebas(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const selesai = (hasil: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(hasil);
    };
    socket.once("connect", () => selesai(false));
    socket.once("error", () => selesai(true));
    socket.setTimeout(500, () => selesai(true));
  });
}

/**
 * Port deploy yang dipilih CLI saat scaffold (`deployPort:` di Jenkinsfile).
 * Pipeline Jenkins memakai port itu, jadi registry harus menyalinnya; port yang
 * dialokasikan sendiri oleh API bisa berbeda dan dashboard lalu memeriksa port kosong.
 */
export function portDariJenkinsfile(isi: string): number | null {
  const cocok = isi.match(/deployPort\s*:\s*(\d+)/);
  if (!cocok) return null;
  const port = Number(cocok[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

async function bacaJenkinsfile(dir: string): Promise<string> {
  return readFile(join(dir, "Jenkinsfile"), "utf8").catch(() => "");
}

async function portDeployBebas(
  baris: BarisRegistry[],
  bebas?: (port: number) => boolean | Promise<boolean>,
): Promise<number> {
  const cekBebas = bebas ?? portBebas;
  const terpakai = baris.map((item) => item.deploy);
  let deploy = portDeployBerikut(terpakai, () => true);
  while (deploy < DEPLOY_AKHIR && !(await cekBebas(deploy))) deploy += LANGKAH;
  return deploy;
}

/**
 * Tambahkan aplikasi ke `registry.tsv` sekali saja dan kembalikan port deploy-nya.
 * Dipanggil sesudah aplikasinya nyata (folder ada), jadi barisnya tidak pernah
 * menunjuk aplikasi hantu. `opsi.dir` = folder aplikasi, tempat Jenkinsfile hasil
 * scaffold dibaca kalau ada.
 */
export async function catatAplikasi(
  workspace: string,
  nama: string,
  opsi: { dir?: string; bebas?: (port: number) => boolean | Promise<boolean> } = {},
): Promise<number> {
  const path = join(workspace, "registry.tsv");
  const isi = await readFile(path, "utf8").catch(() => "");
  const baris = bacaRegistry(isi);
  const terdaftar = baris.find((item) => item.nama === nama);
  if (terdaftar) return terdaftar.deploy;

  const deploy =
    (opsi.dir ? portDariJenkinsfile(await bacaJenkinsfile(opsi.dir)) : null) ??
    (await portDeployBebas(baris, opsi.bebas));

  const penutup = isi === "" || isi.endsWith("\n") ? "" : "\n";
  await appendFile(path, `${penutup}${nama}\t${APP_PORT}\t${deploy}\n`, "utf8");
  return deploy;
}
