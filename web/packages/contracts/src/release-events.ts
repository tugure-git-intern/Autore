import { hasKeys } from "./guards";
import {
  type Deployment,
  type Environment,
  type Release,
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
  kind: "requested" | "build_started" | "digest_verified" | "deploy_result" | "build_failed";
  app: string;
  environment: "staging";
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
    value.environment !== "staging" || !nonEmpty(value.request_id) ||
    !SHA.test(String(value.commit)) || !Number.isInteger(value.build_number)) return false;
  if (!["requested", "build_started", "digest_verified", "deploy_result", "build_failed"].includes(String(value.kind))) {
    return false;
  }
  if (value.kind === "digest_verified" || value.kind === "deploy_result") {
    if (!DIGEST.test(String(value.digest))) return false;
  }
  if (value.kind === "deploy_result") {
    if (!["success", "rolled_back", "failed_no_active", "rollback_failed"].includes(String(value.outcome))) {
      return false;
    }
    if (!nonEmpty(value.deployment_id)) return false;
    if (!isRef(value.active_before) || !isRef(value.active_after)) return false;
  }
  if (value.kind === "build_failed" && !nonEmpty(value.error)) return false;
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

function lingkungan(app: string): Environment[] {
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
      target: null,
      status_konfigurasi: "belum_dikonfigurasi",
      active_deployment_id: null,
    },
  ];
}

/**
 * Melipat event mentah menjadi model release/deployment. TypeScript tetap satu-
 * satunya pemilik transisi; event dari Rust/Jenkins tidak membawa status turunan.
 */
export function foldReleaseEvents(events: ReleaseEvent[]): FoldResult {
  const releases = new Map<string, Release>();
  const deployments = new Map<string, Deployment>();
  const environments = new Map<string, Environment>();

  for (const event of events) {
    if (!isReleaseEvent(event)) throw new Error("invalid release event");
    for (const env of lingkungan(event.app)) {
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
      release = { ...release, image_digest: event.digest! };
      if (release.status === "siap_staging") release = transisiRelease(release, "staging_mulai");
    }

    if (event.kind === "build_failed") {
      if (release.status === "build_berjalan") release = transisiRelease(release, "build_gagal");
      release = { ...release, status: release.status === "draft" ? "gagal" : release.status };
    }

    if (event.kind === "deploy_result") {
      if (release.status === "siap_staging") release = transisiRelease(release, "staging_mulai");
      const deploymentId = event.deployment_id!;
      const sukses = event.outcome === "success";
      const deployment: Deployment = {
        id: deploymentId,
        release_id: release.id,
        environment_id: staging.id,
        image_digest: event.digest!,
        status: sukses ? "sehat" : "gagal",
        health_check_url: event.health_url || "http://127.0.0.1:8153/health",
        mulai_pada: event.ts,
        selesai_pada: event.ts,
        error: sukses ? null : (event.error || event.outcome || "deploy gagal"),
      };
      deployments.set(deployment.id, deployment);

      if (sukses) {
        if (event.active_after?.digest !== event.digest ||
          event.active_after?.deployment_id !== deployment.id) {
          throw new Error("active_after tidak cocok dengan deployment sukses");
        }
        release = transisiRelease(release, "staging_sehat", { deployment, environment: staging });
        environments.set(staging.id, { ...staging, active_deployment_id: deployment.id });
      } else {
        if (release.status === "staging_berjalan") release = transisiRelease(release, "staging_gagal");
        if (event.outcome === "rolled_back") release = transisiRelease(release, "rollback_selesai");
        const lama = event.active_before?.deployment_id ?? staging.active_deployment_id;
        environments.set(staging.id, { ...staging, active_deployment_id: lama ?? null });
      }
    }

    releases.set(key, release);
  }

  return {
    releases: [...releases.values()],
    deployments: [...deployments.values()],
    environments: [...environments.values()],
  };
}
