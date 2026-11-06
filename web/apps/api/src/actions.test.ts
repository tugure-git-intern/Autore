import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  hatchActions,
  spawnAutore,
  type ActionResult,
  type SpawnAction,
  type SpawnResult,
} from "./actions";
import type { PencatatAudit } from "./audit";

/** Status minimal yang lolos validator fail-closed di status.ts. */
function statusJson(apps: string[]): string {
  return JSON.stringify({
    system_status: "idle",
    infra: { jenkins: "active", nexus: "active" },
    stats: { total_apps: apps.length, running_containers: 0 },
    repository_health: {
      score_percent: 0,
      total_repos: apps.length,
      gold: 0,
      silver: 0,
      bronze: apps.length,
    },
    applications: apps.map((id) => ({
      id,
      name: id,
      status: "unknown",
      last_build: "",
      commit_sha: "",
      security_issues: 0,
    })),
    latest_pipeline: {
      status: "idle",
      failure_reason: "",
      stages: [],
      security_summary: "",
      commit_sha: "",
      author: "",
      raw_log: [],
    },
  });
}

const result = (over: Partial<SpawnResult> = {}): SpawnResult => ({
  exitCode: 0,
  stdout: "ok",
  stderr: "",
  ...over,
});

/** Workspace nyata di /tmp: cek "direktori benar-benar ada" ikut teruji, bukan di-mock. */
async function workspace(apps: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "autore-actions-"));
  for (const app of apps) await mkdir(join(dir, app), { recursive: true });
  return dir;
}

function make(
  dir: string,
  options: { spawn?: SpawnAction; listed?: string[]; audit?: PencatatAudit } = {},
) {
  const spawn = options.spawn ?? vi.fn(async () => result());
  const audit = options.audit ?? vi.fn();
  const actions = hatchActions({
    workspace: dir,
    run: async () => statusJson(options.listed ?? ["tes-web", "ui-demo"]),
    spawn,
    audit,
  });
  return {
    actions,
    spawn: spawn as unknown as ReturnType<typeof vi.fn>,
    audit: audit as unknown as ReturnType<typeof vi.fn>,
  };
}

describe("hatchActions", () => {
  it("deploy menjalankan argv untuk aplikasi yang diminta, bukan aplikasi lain", async () => {
    const dir = await workspace(["tes-web", "audit-uji3"]);
    const { actions, spawn } = make(dir, { listed: ["tes-web", "audit-uji3"] });

    const out = await actions.run("deploy", "audit-uji3");

    expect(out).toMatchObject({ ok: true, status: 200, action: "deploy", target: "audit-uji3" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, opts] = spawn.mock.calls[0] as [string, string[], { shell: boolean }];
    expect(file).toBe(process.env.AUTORE_BIN || "autore");
    expect(args).toEqual(["deploy", "--path", join(dir, "audit-uji3")]);
    expect(args.join(" ")).not.toContain("tes-web");
    expect(opts.shell).toBe(false);
  });

  it("deploy mengikuti id yang diminta, bukan aplikasi lain", async () => {
    const dir = await workspace(["tes-web", "audit-uji3"]);
    const { actions, spawn } = make(dir, { listed: ["tes-web", "audit-uji3"] });

    await actions.run("deploy", "tes-web");

    const [, args] = spawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(["deploy", "--path", join(dir, "tes-web")]);
  });

  it("meneruskan identitas sesi ke argv deploy (audit trail commit)", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    await actions.run("deploy", "tes-web", {
      login: "MAliffadlan",
      nama: "Alif Fadlan",
      email: "alif@example.com",
    });

    const [, args] = spawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual([
      "deploy",
      "--path",
      join(dir, "tes-web"),
      "--author-name",
      "Alif Fadlan",
      "--author-email",
      "alif@example.com",
    ]);
  });

  it("deploy tanpa identitas tidak menambah flag author apa pun", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    await actions.run("deploy", "tes-web");

    const [, args] = spawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(["deploy", "--path", join(dir, "tes-web")]);
  });

  it("scan memakai --no-docker dan path aplikasi yang diminta", async () => {
    const dir = await workspace(["tes-web", "ui-demo"]);
    const { actions, spawn } = make(dir);

    const out = await actions.run("scan", "ui-demo");

    expect(out).toMatchObject({ ok: true, status: 200, action: "scan", target: "ui-demo" });
    const [, args] = spawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(["scan", "--no-docker", "--path", join(dir, "ui-demo")]);
  });

  it("menolak id yang tidak ada di daftar aplikasi tanpa menjalankan apa pun", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    await expect(actions.run("scan", "tidak-kenal")).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["../../etc", "tes-web/../../etc", "a b", "tes-web;rm -rf /", "", "a".repeat(65)])(
    "menolak id berbahaya %j dengan 400",
    async (id) => {
      const dir = await workspace(["tes-web"]);
      const { actions, spawn } = make(dir, { listed: ["tes-web", id] });

      await expect(actions.run("scan", id)).resolves.toMatchObject({ ok: false, status: 400 });
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it("menolak aplikasi terdaftar yang direktoriya tidak ada", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir, { listed: ["tes-web", "hantu"] });

    await expect(actions.run("scan", "hantu")).resolves.toMatchObject({ ok: false, status: 404 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("scan tanpa app id ditolak 400", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    await expect(actions.run("scan")).resolves.toMatchObject({ ok: false, status: 400 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("deploy tanpa app id ditolak 400, bukan menjalankan target lama dari server", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    const out = await actions.run("deploy");

    expect(out).toMatchObject({ ok: false, status: 400 });
    expect((out as { error: string }).error).not.toContain("AUTORE_DEPLOY_APP");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("workspace belum diset ditolak 503", async () => {
    const { actions, spawn } = make("");

    await expect(actions.run("deploy", "tes-web")).resolves.toMatchObject({ ok: false, status: 503 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("exit code non-nol jadi 422 yang membawa output", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions } = make(dir, {
      spawn: vi.fn(async () => result({ exitCode: 1, stdout: "1 temuan", stderr: "gagal" })),
    });

    const out = await actions.run("scan", "tes-web");

    expect(out).toMatchObject({ ok: false, status: 422 });
    expect((out as { output: string }).output).toContain("1 temuan");
    expect((out as { output: string }).output).toContain("gagal");
  });

  it("aksi kedua ditolak 409 selagi yang pertama masih jalan, dan spawn hanya sekali", async () => {
    const dir = await workspace(["tes-web"]);
    let release: () => void = () => {};
    let started: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spawnStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const spawn = vi.fn(async () => {
      started();
      await gate;
      return result();
    });
    const { actions } = make(dir, { spawn });

    const first = actions.run("deploy", "tes-web");
    await spawnStarted; // tunggu sampai proses pertama benar-benar berjalan
    const second = await actions.run("scan", "tes-web");

    expect(second).toMatchObject({ ok: false, status: 409 });
    expect((second as { error: string }).error).toContain("deploy");
    expect(spawn).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("lock dilepas setelah aksi selesai", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions } = make(dir);

    await expect(actions.run("scan", "tes-web")).resolves.toMatchObject({ ok: true });
    await expect(actions.run("scan", "tes-web")).resolves.toMatchObject({ ok: true });
  });

  it("timeout jadi 504 dan lock tetap dilepas", async () => {
    const dir = await workspace(["tes-web"]);
    const spawn = vi.fn(async () => {
      throw Object.assign(new Error("killed"), { code: "ETIMEDOUT" });
    });
    const { actions } = make(dir, { spawn });

    const out = await actions.run("scan", "tes-web");

    expect(out).toMatchObject({ ok: false, status: 504 });
    spawn.mockImplementation(async () => result());
    await expect(actions.run("scan", "tes-web")).resolves.toMatchObject({ ok: true });
  });

  it("perintah autore tidak ada di PATH jatuh ke 503", async () => {
    const dir = await workspace(["tes-web"]);
    const spawn = vi.fn(async () => {
      throw Object.assign(new Error("spawn autore ENOENT"), { code: "ENOENT" });
    });
    const { actions } = make(dir, { spawn });

    await expect(actions.run("deploy", "tes-web")).resolves.toMatchObject({ ok: false, status: 503 });
  });

  it("output dipotong supaya toast tidak membawa ratusan kilobyte", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions } = make(dir, {
      spawn: vi.fn(async () => result({ stdout: "x".repeat(200_000), exitCode: 1 })),
    });

    const out = (await actions.run("scan", "tes-web")) as ActionResult;

    expect(out.ok).toBe(false);
    expect((out as { output: string }).output.length).toBeLessThanOrEqual(4_000);
  });

  it("kegagalan membaca daftar aplikasi jadi 503, bukan aksi buta", async () => {
    const dir = await workspace(["tes-web"]);
    const actions = hatchActions({
      workspace: dir,
      run: async () => {
        throw new Error("autore tidak bisa dipanggil");
      },
      spawn: vi.fn(async () => result()),
    });

    await expect(actions.run("scan", "tes-web")).resolves.toMatchObject({ ok: false, status: 503 });
  });
});

describe("spawnAutore", () => {
  const opts = { shell: false as const, timeout: 2_000, cwd: tmpdir(), env: process.env };

  it("exit non-nol diselesaikan sebagai hasil, bukan exception", async () => {
    const out = await spawnAutore("false", [], opts);

    expect(out.exitCode).not.toBe(0);
  });

  it("proses yang menggantung dipotong timeout dan ditandai ETIMEDOUT", async () => {
    await expect(spawnAutore("sleep", ["5"], { ...opts, timeout: 150 })).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
  });

  it("perintah yang tidak ada ditandai ENOENT", async () => {
    await expect(spawnAutore("autore-tidak-ada-xyz", [], opts)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("menangkap stdout dan stderr apa adanya", async () => {
    const out = await spawnAutore(
      "node",
      ["-e", "process.stdout.write('keluar'); process.stderr.write('galat'); process.exit(2)"],
      opts,
    );

    expect(out).toMatchObject({ exitCode: 2, stdout: "keluar", stderr: "galat" });
  });
});

describe("quick-start", () => {
  const INPUT = { nama: "coba-web", stack: "nodejs", kode: "contoh" } as const;

  it("menjalankan argv tetap dengan lock, cwd workspace, dan penanda tahap aktif", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    const out = await actions.quickStart(INPUT);

    expect(out).toMatchObject({ ok: true, status: 200, action: "quick-start", target: "coba-web" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, opts] = spawn.mock.calls[0] as [
      string,
      string[],
      { shell: boolean; cwd: string; env: NodeJS.ProcessEnv; timeout: number },
    ];
    expect(file).toBe(process.env.AUTORE_BIN || "autore");
    expect(args).toEqual([
      "quick-start",
      "--path",
      dir,
      "--app-name",
      "coba-web",
      "--stack",
      "nodejs",
      "--kode",
      "contoh",
    ]);
    expect(opts.shell).toBe(false);
    expect(opts.cwd).toBe(dir);
    expect(opts.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(opts.env.AUTORE_PROGRESS).toBe("json");
    expect(opts.timeout).toBe(180_000);
  });

  it("mengembalikan URL repo yang dibaca dari keluaran CLI", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions } = make(dir, {
      spawn: vi.fn(async () =>
        result({ stdout: "  2/4 Repo GitHub tugure-git-intern/coba-web (baru dibuat)\n" }),
      ),
    });

    const out = await actions.quickStart(INPUT);

    expect(out).toMatchObject({ repo: "https://github.com/tugure-git-intern/coba-web" });
  });

  it("menolak folder aplikasi yang sudah ada tanpa menjalankan apa pun", async () => {
    const dir = await workspace(["coba-web"]);
    const { actions, spawn } = make(dir);

    const out = await actions.quickStart(INPUT);

    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menolak quick-start kedua selama aksi lain masih berjalan", async () => {
    const dir = await workspace(["tes-web"]);
    let lepas: ((hasil: SpawnResult) => void) | undefined;
    const spawn = vi.fn(() => new Promise<SpawnResult>((resolve) => { lepas = resolve; }));
    const { actions } = make(dir, { spawn });

    const berjalan = actions.run("deploy", "tes-web");
    // Lock dipegang setelah spawn dipanggil: menunggu spawn membuat urutannya pasti,
    // bukan bergantung pada berapa kali event loop sempat berputar.
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    const kedua = await actions.quickStart(INPUT);

    expect(kedua).toMatchObject({ ok: false, status: 409 });
    lepas?.(result());
    expect(await berjalan).toMatchObject({ ok: true, action: "deploy" });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("menerjemahkan kegagalan CLI jadi 422 dengan keluaran mentahnya", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions } = make(dir, {
      spawn: vi.fn(async () =>
        result({ exitCode: 1, stdout: "  1/4 File pipeline dibuat:", stderr: "ERROR: Token GitHub ditolak" }),
      ),
    });

    const out = await actions.quickStart(INPUT);

    expect(out).toMatchObject({ ok: false, status: 422 });
    expect(out.ok === false && out.output).toContain("Token GitHub ditolak");
    expect(out.ok === false && out.output).toContain("1/4");
  });

  it("menerjemahkan timeout jadi 504 dan perintah-hilang jadi 503", async () => {
    const dir = await workspace(["tes-web"]);
    const timeout = make(dir, {
      spawn: vi.fn(async () => {
        throw Object.assign(new Error("lewat batas"), { code: "ETIMEDOUT" });
      }),
    });
    const hilang = make(dir, {
      spawn: vi.fn(async () => {
        throw Object.assign(new Error("tidak ada"), { code: "ENOENT" });
      }),
    });

    expect(await timeout.actions.quickStart(INPUT)).toMatchObject({ ok: false, status: 504 });
    expect(await hilang.actions.quickStart(INPUT)).toMatchObject({ ok: false, status: 503 });
  });

  it("menolak 503 kalau AUTORE_WORKSPACE belum diset di unit", async () => {
    const kosong = hatchActions({
      workspace: "   ",
      run: async () => statusJson(["tes-web"]),
      spawn: vi.fn(async () => result()),
    });

    expect(await kosong.quickStart(INPUT)).toMatchObject({ ok: false, status: 503 });
  });
});

describe("registry aplikasi", () => {
  const INPUT = { nama: "coba-web", stack: "nodejs", kode: "contoh" } as const;

  it("mencatat aplikasi baru supaya muncul di daftar dashboard", async () => {
    const dir = await workspace(["tes-web"]);
    await writeFile(join(dir, "registry.tsv"), "tes-web\t8000\t8003\n");
    const { actions } = make(dir, {
      spawn: vi.fn(async () => {
        await mkdir(join(dir, "coba-web"), { recursive: true });
        return result();
      }),
    });

    const out = await actions.quickStart(INPUT);

    expect(out).toMatchObject({ ok: true });
    const baris = (await readFile(join(dir, "registry.tsv"), "utf8")).trimEnd().split("\n");
    expect(baris[0]).toBe("tes-web\t8000\t8003");
    const [, app, deploy] = baris[1].split("\t");
    expect([baris[1].split("\t")[0], app]).toEqual(["coba-web", "8000"]);
    expect(Number(deploy)).toBeGreaterThanOrEqual(8003);
    expect(Number(deploy) % 10).toBe(3);
  });

  it("memakai deployPort dari Jenkinsfile hasil scaffold, bukan alokasi sendiri", async () => {
    const dir = await workspace(["tes-web"]);
    await writeFile(join(dir, "registry.tsv"), "tes-web\t8000\t8003\n");
    const { actions } = make(dir, {
      spawn: vi.fn(async () => {
        await mkdir(join(dir, "coba-web"), { recursive: true });
        await writeFile(
          join(dir, "coba-web", "Jenkinsfile"),
          "autorePipeline(appName: 'coba-web', appPort: 8000, deployPort: 8084)\n",
        );
        return result();
      }),
    });

    await actions.quickStart(INPUT);

    const baris = (await readFile(join(dir, "registry.tsv"), "utf8")).trimEnd().split("\n");
    expect(baris[1]).toBe("coba-web\t8000\t8084");
  });

  it("tetap mencatat aplikasi yang build pertamanya gagal, karena aplikasinya nyata", async () => {
    const dir = await workspace(["tes-web"]);
    await writeFile(join(dir, "registry.tsv"), "");
    const { actions } = make(dir, {
      spawn: vi.fn(async () => {
        await mkdir(join(dir, "coba-web"), { recursive: true });
        return result({ exitCode: 1, stderr: "ERROR: job Jenkins gagal dibuat" });
      }),
    });

    const out = await actions.quickStart(INPUT);

    expect(out).toMatchObject({ status: 422 });
    const baris = (await readFile(join(dir, "registry.tsv"), "utf8")).trimEnd().split("\n");
    expect(baris).toHaveLength(1);
    expect(baris[0].startsWith("coba-web\t8000\t")).toBe(true);
  });

  it("tidak mencatat apa pun kalau folder aplikasi sudah ada (409)", async () => {
    const dir = await workspace(["coba-web"]);
    await writeFile(join(dir, "registry.tsv"), "");
    const { actions } = make(dir);

    const out = await actions.quickStart(INPUT);

    expect(out).toMatchObject({ status: 409 });
    expect(await readFile(join(dir, "registry.tsv"), "utf8")).toBe("");
  });

  it("tidak mencatat kalau CLI tidak meninggalkan folder aplikasi", async () => {
    const dir = await workspace(["tes-web"]);
    await writeFile(join(dir, "registry.tsv"), "");
    const { actions } = make(dir, {
      spawn: vi.fn(async () => result({ exitCode: 1, stderr: "ERROR: nama ditolak" })),
    });

    await actions.quickStart(INPUT);

    expect(await readFile(join(dir, "registry.tsv"), "utf8")).toBe("");
  });
});

describe("audit aksi (jejak siapa yang menekan tombol)", () => {
  const SESI = {
    login: "MAliffadlan",
    nama: "Alif Fadlan",
    email: "alif@example.com",
  };

  it("mencatat login, aksi, target, dan exit code saat deploy jalan", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, audit } = make(dir);

    await actions.run("deploy", "tes-web", SESI);

    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({
      login: "MAliffadlan",
      email: "alif@example.com",
      action: "deploy",
      target: "tes-web",
      exit: 0,
    });
  });

  it("tetap mencatat walau CLI keluar gagal — deploy yang gagal juga harus ada jejaknya", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, audit } = make(dir, {
      spawn: vi.fn(async () => result({ exitCode: 1, stderr: "ERROR: bind port bentrok" })),
    });

    const out = await actions.run("deploy", "tes-web", SESI);

    expect(out).toMatchObject({ ok: false, status: 422 });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "deploy", exit: 1 }));
  });

  it("tidak mencatat apa pun kalau aplikasi tidak terdaftar (tidak ada yang dijalankan)", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, audit } = make(dir);

    const out = await actions.run("deploy", "bukan-app", SESI);

    expect(out).toMatchObject({ status: 404 });
    expect(audit).not.toHaveBeenCalled();
  });
});
