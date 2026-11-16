import { hasKeys } from "./guards";
import {
  type AksiRelease,
  type Deployment,
  type Environment,
  type Release,
  type StatusRelease,
  transisiRelease,
} from "./releases";

export type DeployOutcome = "success" | "rolled_back" | "failed_no_active" | "rollback_failed";

export type ActiveDeploymentRef = {
  deployment_id: string;
  digest: string;
};

export type ReleaseEvent = {
  id: string;
  ts: string;
  kind: "requested" | "build_started" | "digest_verified" | "deploy_result" | "build_failed" |
    "approved" | "rejected";
  app: string;
  environment: "staging" | "production";
  request_id: string;
  commit: string;
  build_number: number;
  actor?: string;
  digest?: string;
  image_ref?: string;
  deployment_id?: string;
  outcome?: DeployOutcome;
  active_before?: ActiveDeploymentRef | null;
  active_after?: ActiveDeploymentRef | null;
  health?: string;
  health_url?: string;
  error?: string;
};

export type ReleaseEventsPayload = {
  version: 1;
  events: ReleaseEvent[];
};

export type FoldResult = {
  releases: Release[];
  deployments: Deployment[];
  environments: Environment[];
  /**
   * Event yang TIDAK dipakai fold beserta alasannya (abaikan-dan-catat): hanya
   * dipakai jalur rollback sengaja, di mana status release tidak punya transisi
   * menuju `rolled_back`. Dicatat supaya kejadiannya terlihat, bukan hilang.
   */
  diabaikan: DiabaikanEvent[];
};

export type DiabaikanEvent = {
  event_id: string;
  alasan: string;
};

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRef(value: unknown): value is ActiveDeploymentRef | null | undefined {
  if (value === null || value === undefined) return true;
  return hasKeys(value, ["deployment_id", "digest"]) &&
    nonEmpty(value.deployment_id) &&
    DIGEST.test(String(value.digest));
}

/** Validator event mentah; tidak tahu status release atau urutan transisi. */
export function isReleaseEvent(value: unknown): value is ReleaseEvent {
  if (!hasKeys(
    value,
    ["id", "ts", "kind", "app", "environment", "request_id", "commit", "build_number"],
    ["actor", "digest", "image_ref", "deployment_id", "outcome", "active_before",
      "active_after", "health", "health_url", "error"],
  )) {
    return false;
  }
  if (!nonEmpty(value.id) || !nonEmpty(value.ts) || !nonEmpty(value.app) ||
    (value.environment !== "staging" && value.environment !== "production") || !nonEmpty(value.request_id) ||
    !SHA.test(String(value.commit)) || !Number.isInteger(value.build_number)) return false;
  if (!["requested", "build_started", "digest_verified", "deploy_result", "build_failed",
    "approved", "rejected"].includes(String(value.kind))) {
    return false;
  }
  if (value.kind === "digest_verified" || value.kind === "deploy_result") {
    if (!DIGEST.test(String(value.digest))) return false;
  }
  if (value.kind === "deploy_result") {
    if (!["success", "rolled_back", "failed_no_active", "rollback_failed"].includes(String(value.outcome))) {
      return false;
    }
    // Sukses berarti aplikasi benar-benar sehat; tanpa bukti health `ok`, event
    // tidak boleh membuat deployment sehat dan membuka gerbang promosi.
    if (value.outcome === "success" && value.health !== "ok") return false;
    if (!nonEmpty(value.deployment_id)) return false;
    if (!isRef(value.active_before) || !isRef(value.active_after)) return false;
    // Koherensi outcome vs deployment sebelumnya: rollback hanya bermakna bila ada
    // deployment sehat (kandidatnya) yang menampung hasil rollback; kegagalan tanpa
    // deployment sebelumnya justru harus TIDAK membawa active_before, supaya
    // "tidak ada yang bisa di-rollback" tidak tersamar sebagai rollback.
    const adaSebelum = value.active_before !== null && value.active_before !== undefined;
    if ((value.outcome === "rolled_back" || value.outcome === "rollback_failed") && !adaSebelum) {
      return false;
    }
    if (value.outcome === "failed_no_active" && adaSebelum) return false;
  }
  if (value.kind === "build_failed" && !nonEmpty(value.error)) return false;
  // approval selalu butuh actor supaya siapa yang memutuskan tetap terlacak.
  if ((value.kind === "approved" || value.kind === "rejected") && !nonEmpty(value.actor)) return false;
  // rejected memakai field error yang sudah ada sebagai alasan penolakan; tidak
  // menambah field baru karena ledger Rust memakai bentuk event yang sama.
  if (value.kind === "rejected" && !nonEmpty(value.error)) return false;
  return true;
}

export function parseReleaseEvents(value: unknown): ReleaseEventsPayload {
  if (!hasKeys(value, ["version", "events"]) || value.version !== 1 || !Array.isArray(value.events)) {
    throw new Error("invalid release events payload");
  }
  const events = value.events.map((event) => {
    if (!isReleaseEvent(event)) throw new Error("invalid release event");
    return event;
  });
  return { version: 1, events };
}

function releaseId(event: ReleaseEvent): string {
  return `${event.app}:${event.commit}:${event.build_number}`;
}

function releaseAwal(event: ReleaseEvent): Release {
  return {
    id: releaseId(event),
    application_id: event.app,
    commit_sha: event.commit,
    image_digest: null,
    status: "draft",
    approved_by: null,
    alasan: null,
    dibuat_oleh: event.actor?.trim() || "pipeline",
    dibuat_pada: event.ts,
  };
}

/** Target production datang dari konfigurasi pemanggil: core tidak tahu app mana
 * yang punya production. `null` = app ini belum dikonfigurasi, jadi promosinya
 * ditolak sebelum ada job yang dijalankan. */
function lingkungan(app: string, productionTarget: string | null): Environment[] {
  const productionConfigured = productionTarget !== null;
  return [
    {
      id: `${app}:staging`,
      application_id: app,
      nama: "staging",
      target: "vps-staging",
      status_konfigurasi: "terkonfigurasi",
      active_deployment_id: null,
    },
    {
      id: `${app}:production`,
      application_id: app,
      nama: "production",
      target: productionTarget,
      status_konfigurasi: productionConfigured ? "terkonfigurasi" : "belum_dikonfigurasi",
      active_deployment_id: null,
    },
  ];
}

/**
 * Pemilihan aksi rollback: status + environment yang dipanggil. `null` = tidak ada
 * transisi sah, jadi event itu diabaikan-dan-dicatat, bukan dilempar (jangan sampai
 * satu event tak sah membuat seluruh GET /api/releases jadi 502).
 */
export function aksiRollback(
  status: StatusRelease,
  isProduction: boolean,
): AksiRelease | null {
  if (status === "gagal") return "rollback_selesai";
  if (!isProduction && status === "menunggu_persetujuan") {
    return "rollback_staging_dari_menunggu_persetujuan";
  }
  if (!isProduction && status === "disetujui") return "rollback_staging_dari_disetujui";
  if (!isProduction && status === "ditolak") return "rollback_staging_dari_ditolak";
  if (!isProduction && status === "aktif") return "rollback_staging_dari_aktif";
  if (isProduction && status === "aktif") return "rollback_production_dari_aktif";
  return null;
}

/**
 * Waktu event dalam milidetik. Ledger lama menulis ISO, ledger baru menulis Unix
 * detik dengan akhiran `Z`; dua bentuk itu harus bisa dibandingkan.
 */
function waktuEvent(ts: string): number | null {
  if (/^\d+Z?$/.test(ts)) return Number(ts.replace(/Z$/, "")) * 1000;
  const nilai = Date.parse(ts);
  return Number.isNaN(nilai) ? null : nilai;
}

/**
 * Satu event per id (kemunculan pertama menang) dan urut waktu. Event ganda dari
 * penulisan ulang akan menggeser status dua kali bila tidak dideduplikasi, dan
 * urutan berkas tidak boleh menentukan hasil fold. Bila ada `ts` yang tidak bisa
 * dibaca, urutan asli dipertahankan daripada mengurutkan asal-asalan.
 */
export function urutkanEvent(events: ReleaseEvent[]): ReleaseEvent[] {
  const unik = new Map<string, ReleaseEvent>();
  for (const event of events) if (!unik.has(event.id)) unik.set(event.id, event);
  const hasil = [...unik.values()];
  const waktu = hasil.map((event) => waktuEvent(event.ts));
  if (waktu.some((nilai) => nilai === null)) return hasil;
  return hasil
    .map((event, indeks) => ({ event, waktu: waktu[indeks]! }))
    .sort((kiri, kanan) => kiri.waktu - kanan.waktu)
    .map((item) => item.event);
}

/**
 * Melipat event mentah menjadi model release/deployment. TypeScript tetap satu-
 * satunya pemilik transisi; event dari Rust/Jenkins tidak membawa status turunan.
 */
export function foldReleaseEvents(
  events: ReleaseEvent[],
  productionTarget: string | null = null,
): FoldResult {
  const releases = new Map<string, Release>();
  const deployments = new Map<string, Deployment>();
  const environments = new Map<string, Environment>();
  const diabaikan: DiabaikanEvent[] = [];
  const abaikan = (event: ReleaseEvent, alasan: string): boolean => {
    diabaikan.push({ event_id: event.id, alasan });
    return true;
  };

  for (const event of urutkanEvent(events)) {
    if (!isReleaseEvent(event)) throw new Error("invalid release event");
    for (const env of lingkungan(event.app, productionTarget)) {
      environments.set(env.id, environments.get(env.id) ?? env);
    }
    const key = releaseId(event);
    let release = releases.get(key) ?? releaseAwal(event);
    const staging = environments.get(`${event.app}:staging`)!;

    if (event.kind === "requested") {
      release = { ...release, dibuat_oleh: event.actor?.trim() || release.dibuat_oleh };
    }

    if (event.kind === "build_started" || event.kind === "digest_verified" ||
      event.kind === "deploy_result" || event.kind === "build_failed") {
      if (release.status === "draft") release = transisiRelease(release, "build_mulai");
    }

    if (event.kind === "digest_verified" || event.kind === "deploy_result") {
      if (release.status === "build_berjalan") release = transisiRelease(release, "build_sukses");
      // Rollback sengaja men-deploy digest LAMA: image_digest release yang di-rollback
      // tidak boleh ditimpa digest target, kalau tidak riwayat build jadi dusta.
      if (event.outcome !== "rolled_back") release = { ...release, image_digest: event.digest! };
      if (release.status === "siap_staging") release = transisiRelease(release, "staging_mulai");
    }

    if (event.kind === "build_failed") {
      if (release.status === "build_berjalan") release = transisiRelease(release, "build_gagal");
      release = { ...release, status: release.status === "draft" ? "gagal" : release.status };
    }

    if (event.kind === "approved") {
      // approve kedua pada release yang sudah disetujui idempoten: tidak mengubah
      // apa pun (termasuk approved_by) supaya event ganda tidak merusak jejak.
      if (release.status === "menunggu_persetujuan") {
        release = transisiRelease(release, "approve", { actor: event.actor });
      } else if (release.status !== "disetujui") {
        // Approve untuk status selain menunggu_persetujuan: abaikan.
        abaikan(event, "approve hanya untuk release menunggu_persetujuan");
        continue;
      }
    }

    if (event.kind === "rejected") {
      // ditolak tidak punya transisi keluar: satu-satunya jalan masuk adalah dari
      // menunggu_persetujuan, sehingga tidak ada rute ditolak -> disetujui.
      if (release.status !== "menunggu_persetujuan") {
        // Reject untuk status selain menunggu_persetujuan: abaikan.
        abaikan(event, "reject hanya untuk release menunggu_persetujuan");
        continue;
      } else {
        release = transisiRelease(release, "reject", { alasan: event.error });
      }
    }

    if (event.kind === "deploy_result") {
      const isProduction = event.environment === "production";
      // K1: promosi production hanya dari release yang sudah disetujui; menunggu_
      // persetujuan tidak boleh langsung men-deploy production. Rollback sengaja
      // bukan promosi, jadi tidak lewat gerbang ini.
      // Retry promosi setelah promosi pertama gagal health hanya boleh untuk
      // release yang memang pernah lolos approval; `gagal` dari build gagal tidak
      // boleh jadi pintu masuk production.
      const bolehProduction =
        release.status === "disetujui" || release.status === "production_berjalan" ||
        (release.status === "gagal" && Boolean(release.approved_by));
      if (isProduction && event.outcome !== "rolled_back" && !bolehProduction) {
        // Release belum disetujui tapi ada event deploy production: abaikan.
        // Bisa terjadi bila event tertulis sebelum approval, atau race condition.
        abaikan(event, "production deploy hanya untuk release disetujui");
        continue;
      }
      if (isProduction && event.outcome !== "rolled_back") {
        // Digest production wajib sama dengan deployment sehat yang sedang aktif di
        // staging aplikasi itu: produksi memakai gambar yang sudah lolos staging,
        // bukan hasil build ulang yang belum diuji.
        const aktifStaging = environments.get(`${event.app}:staging`)?.active_deployment_id;
        const deploymentStaging = aktifStaging ? deployments.get(aktifStaging) : undefined;
        if (!deploymentStaging || deploymentStaging.image_digest !== event.digest) {
          // Digest tidak cocok: event ini tidak valid untuk promosi, abaikan tapi catat.
          // Bisa terjadi bila release disetujui lalu build baru deploy staging sebelum promosi.
          abaikan(event, "digest production tidak cocok dengan deployment staging aktif");
          continue;
        } else {
          if (release.status === "disetujui") release = transisiRelease(release, "production_mulai");
          else if (release.status === "gagal" && release.approved_by) {
            release = transisiRelease(release, "production_ulang");
          }
        }
      }
      if (!isProduction && release.status === "siap_staging") release = transisiRelease(release, "staging_mulai");
      const deploymentId = event.deployment_id!;
      const sukses = event.outcome === "success";
      // Rollback yang sehat mengembalikan layanan lama: deployment target memang
      // sehat, jadi jangan ditandai gagal hanya karena outcome-nya bukan "success".
      const sehat = sukses || (event.outcome === "rolled_back" && event.health === "ok");
      const envTarget = isProduction ? environments.get(`${event.app}:production`)! : staging;
      // Rollback men-deploy digest milik release lain: kepemilikan deployment ikut
      // pemilik digest, bukan release yang memicu rollback. Tanpa ini deployment
      // target tercatat milik release baru dan hilang sebagai kandidat rollback.
      const pemilikDigest =
        event.outcome === "rolled_back"
          ? [...releases.values()].find((item) => item.image_digest === event.digest) ?? null
          : null;
      const deployment: Deployment = {
        id: deploymentId,
        release_id: pemilikDigest?.id ?? release.id,
        environment_id: envTarget.id,
        image_digest: event.digest!,
        status: sehat ? "sehat" : "gagal",
        health_check_url: event.health_url || (isProduction ? "http://127.0.0.1:8154/health" : "http://127.0.0.1:8153/health"),
        mulai_pada: event.ts,
        selesai_pada: event.ts,
        error: sehat ? null : (event.error || event.outcome || "deploy gagal"),
      };
      deployments.set(deployment.id, deployment);

      if (sukses) {
        if (event.active_after?.digest !== event.digest ||
          event.active_after?.deployment_id !== deployment.id) {
          // active_after tidak cocok: abaikan event sukses ini.
          // Tanpa validasi pointer, deployment bisa menunjuk ke hal yang tidak ada.
          abaikan(event, "active_after tidak cocok dengan deployment sukses");
          continue;
        } else {
          if (isProduction) {
            release = transisiRelease(release, "production_sehat", { deployment, environment: envTarget });
          } else {
            release = transisiRelease(release, "staging_sehat", { deployment, environment: staging });
          }
          environments.set(envTarget.id, { ...envTarget, active_deployment_id: deployment.id });
        }
      } else {
        let abaikanIni = false;
        if (event.outcome === "rolled_back") {
          // Rollback sengaja ber-outcome bukan "success": jangan ditandai gagal dulu,
          // karena rollback yang sehat justru mengembalikan layanan lama.
          const aksi = aksiRollback(release.status, isProduction);
          const kandidatGagal =
            !aksi &&
            event.active_after !== undefined &&
            event.active_after !== null &&
            event.active_after.deployment_id !== event.deployment_id;
          if (aksi) {
            // Tanpa konteks deployment: validasiDeploymentSehat hanya untuk
            // staging_sehat/production_sehat, dan image_digest release yang di-rollback
            // sengaja tidak disentuh.
            release = transisiRelease(release, aksi);
          } else if (kandidatGagal) {
            // Build baru gagal sehat lalu di-rollback: penanda kegagalan dulu, baru
            // status akhir rolled_back.
            if (isProduction && release.status === "production_berjalan") {
              release = transisiRelease(release, "production_gagal");
            }
            if (!isProduction && release.status === "staging_berjalan") {
              release = transisiRelease(release, "staging_gagal");
            }
            const mundur = aksiRollback(release.status, isProduction);
            if (mundur) release = transisiRelease(release, mundur);
            else abaikanIni = abaikan(event, `rollback tanpa transisi sah dari status ${release.status}`);
          } else {
            abaikanIni = abaikan(event, `rollback tanpa transisi sah dari status ${release.status}`);
          }
        } else {
          if (isProduction && release.status === "production_berjalan") release = transisiRelease(release, "production_gagal");
          if (!isProduction && release.status === "staging_berjalan") release = transisiRelease(release, "staging_gagal");
        }
        // Event yang diabaikan tidak boleh menggeser pointer: dia memang tidak
        // menggambarkan perubahan nyata di environment mana pun.
        if (!abaikanIni) {
          const kandidat = event.outcome === "failed_no_active"
            ? null
            : (event.active_after?.deployment_id ?? event.active_before?.deployment_id ??
              envTarget.active_deployment_id);
          // Pointer hantu membuat promosi membandingkan digest dengan deployment
          // yang tidak pernah ada; referensi asing tidak boleh menggeser pointer.
          const lama = kandidat !== null && !deployments.has(kandidat)
            ? envTarget.active_deployment_id
            : kandidat;
          if (kandidat !== null && lama !== kandidat) {
            abaikan(event, `pointer deployment ${kandidat} tidak dikenal`);
          }
          environments.set(envTarget.id, { ...envTarget, active_deployment_id: lama ?? null });
        }
      }
    }

    releases.set(key, release);
  }

  return {
    releases: [...releases.values()],
    deployments: [...deployments.values()],
    environments: [...environments.values()],
    diabaikan,
  };
}

