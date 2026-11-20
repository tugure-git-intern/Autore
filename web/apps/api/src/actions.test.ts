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
  options: { spawn?: SpawnAction; listed?: string[]; audit?: PencatatAudit; orgBawaan?: string } = {},
) {
  const spawn = options.spawn ?? vi.fn(async () => result());
  const audit = options.audit ?? vi.fn();
  const actions = hatchActions({
    workspace: dir,
    run: async () => statusJson(options.listed ?? ["tes-web", "ui-demo"]),
    spawn,
    audit,
    orgBawaan: options.orgBawaan,
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

  it("menolak jenis aksi di luar deploy/scan tanpa menjalankan apa pun", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    // Panggilan runtime di luar tipe: dulu jenis apa pun selain deploy diam-diam jadi scan.
    const paksa = actions.run as unknown as (kind: string, id: string) => Promise<ActionResult>;
    const out = await paksa("remove", "tes-web");

    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(out.ok === false ? out.error : "").toContain("remove");
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
    const spawn = vi.fn(async (): Promise<SpawnResult> => {
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

  it("org kosong memakai org bawaan unit, bukan akun pemilik token", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir, { orgBawaan: "tugure-reasuransi" });

    await actions.quickStart(INPUT);

    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(["--org", "tugure-reasuransi"]));
  });

  it("org yang diisi pemanggil mengalahkan org bawaan", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir, { orgBawaan: "tugure-reasuransi" });

    await actions.quickStart({ ...INPUT, org: "org-lain" });

    const args = spawn.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(["--org", "org-lain"]));
    expect(args).not.toContain("tugure-reasuransi");
  });

  it("tanpa org bawaan dan tanpa org pemanggil, flag --org tidak dikirim", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir, { orgBawaan: "  " });

    await actions.quickStart(INPUT);

    expect(spawn.mock.calls[0][1]).not.toContain("--org");
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

  it("mencatat audit walau spawn gagal dijalankan — percobaan pun harus ada jejaknya", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, audit } = make(dir, {
      spawn: vi.fn(async () => {
        throw Object.assign(new Error("spawn autore ENOENT"), { code: "ENOENT" });
      }),
    });

    const out = await actions.run("deploy", "tes-web", SESI);

    expect(out).toMatchObject({ ok: false, status: 503 });
    expect(audit).toHaveBeenCalledWith({
      login: "MAliffadlan",
      email: "alif@example.com",
      action: "deploy",
      target: "tes-web",
      exit: -1,
    });
  });
});

describe("connect", () => {
  const SESI = { login: "MAliffadlan", nama: "Alif Fadlan", email: "alif@example.com" };
  const INPUT = {
    repo: "https://github.com/tugure-reasuransi/autore-demo",
    nama: "coba-connect",
    branch: "main",
  } as const;

  it("menjalankan argv connect dengan lock, cwd workspace, dan penanda tahap aktif", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    const out = await actions.connect(INPUT);

    expect(out).toMatchObject({ ok: true, status: 200, action: "connect", target: "coba-connect" });
    const [file, args, opts] = spawn.mock.calls[0] as [
      string,
      string[],
      { shell: boolean; cwd: string; env: NodeJS.ProcessEnv; timeout: number },
    ];
    expect(file).toBe(process.env.AUTORE_BIN || "autore");
    expect(args).toEqual([
      "connect",
      "--path",
      dir,
      "--repo",
      INPUT.repo,
      "--app-name",
      "coba-connect",
      "--branch",
      "main",
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
        result({ stdout: "  • Repo GitHub    tugure-reasuransi/autore-demo (tersambung)\n" }),
      ),
    });

    expect(await actions.connect(INPUT)).toMatchObject({
      repo: "https://github.com/tugure-reasuransi/autore-demo",
    });
  });

  it("meneruskan peringatan health dari stdout CLI", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions } = make(dir, {
      spawn: vi.fn(async () =>
        result({
          stdout:
            "  1/4 File pipeline dibuat:\nPERINGATAN_HEALTH: Repo ini belum punya endpoint /health.\n  • Repo GitHub    tugure-reasuransi/autore-demo (tersambung)\n",
        }),
      ),
    });

    const out = await actions.connect(INPUT);

    expect(out.ok).toBe(true);
    expect(out.ok && out.peringatan).toBe("Repo ini belum punya endpoint /health.");
  });

  it("tanpa baris peringatan, field peringatan tidak ada", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions } = make(dir, {
      spawn: vi.fn(async () => result({ stdout: "  • Repo GitHub    tugure-reasuransi/autore-demo\n" })),
    });

    const out = await actions.connect(INPUT);

    expect(out.ok && out.peringatan).toBeUndefined();
  });

  it("quick-start ikut meneruskan peringatan health", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions } = make(dir, {
      spawn: vi.fn(async () =>
        result({ stdout: "PERINGATAN_HEALTH: Repo ini belum punya endpoint /health.\n" }),
      ),
    });

    const out = await actions.quickStart({ nama: "coba-web", stack: "nodejs", kode: "contoh" });

    expect(out.ok && out.peringatan).toBe("Repo ini belum punya endpoint /health.");
  });

  it("menolak folder aplikasi yang sudah ada tanpa menjalankan apa pun", async () => {
    const dir = await workspace(["coba-connect"]);
    const { actions, spawn } = make(dir);

    expect(await actions.connect(INPUT)).toMatchObject({ ok: false, status: 409 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("deploy dan connect tidak boleh jalan bersamaan untuk aplikasi mana pun", async () => {
    const dir = await workspace(["tes-web"]);
    let lepas: ((hasil: SpawnResult) => void) | undefined;
    const spawn = vi.fn(() => new Promise<SpawnResult>((resolve) => { lepas = resolve; }));
    const { actions } = make(dir, { spawn });

    const berjalan = actions.connect(INPUT);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    expect(await actions.run("deploy", "tes-web")).toMatchObject({ ok: false, status: 409 });
    expect(await actions.connect({ ...INPUT, nama: "lain-lagi" })).toMatchObject({
      ok: false,
      status: 409,
    });
    lepas?.(result());
    await berjalan;
  });

  it("mencatat jejak audit walau CLI keluar gagal", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, audit } = make(dir, {
      spawn: vi.fn(async () => result({ exitCode: 1, stderr: "ERROR: gagal push" })),
    });

    expect(await actions.connect(INPUT, SESI)).toMatchObject({ ok: false, status: 422 });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "connect", target: "coba-connect", exit: 1 }),
    );
  });
});

describe("remove", () => {
  const SESI = { login: "MAliffadlan", nama: "Alif Fadlan", email: "alif@example.com" };

  it("menolak konfirmasi yang berbeda tanpa menjalankan CLI", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    await expect(actions.remove("tes-web", "lain")).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["../lain", "a/b", "", "a b", "a".repeat(65)])(
    "menolak id yang menyerobot path %j dengan 400",
    async (id) => {
      const dir = await workspace(["tes-web"]);
      const { actions, spawn } = make(dir, { listed: [id] });

      await expect(actions.remove(id, id)).resolves.toMatchObject({ ok: false, status: 400 });
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it("menghapus app yatim: folder sudah hilang tapi baris registry masih ada", async () => {
    const dir = await workspace([]);
    await writeFile(join(dir, "registry.tsv"), "app-a\t8000\t8003\n");
    const { actions, spawn } = make(dir, { listed: [] });

    const out = await actions.remove("app-a", "app-a");

    expect(out).toMatchObject({ ok: true, status: 200, action: "remove", target: "app-a" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, opts] = spawn.mock.calls[0] as [
      string,
      string[],
      { shell: boolean; timeout: number },
    ];
    expect(file).toBe(process.env.AUTORE_BIN || "autore");
    expect(args).toEqual(["hapus-app", "app-a", "--konfirmasi", "app-a"]);
    expect(opts.shell).toBe(false);
    expect(opts.timeout).toBe(120_000);
  });

  it("mencatat audit walau CLI keluar 1, dan tidak meneruskan warna ANSI ke dashboard", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, audit } = make(dir, {
      spawn: vi.fn(async () =>
        result({
          exitCode: 1,
          stdout:
            "\u001b[32m\u001b[1m✔\u001b[0m registry.tsv dibersihkan\n\u001b[31m\u001b[1m✖\u001b[0m job Jenkins gagal",
        }),
      ),
    });

    const out = (await actions.remove("tes-web", "tes-web", SESI)) as ActionResult;

    expect(out).toMatchObject({ ok: false, status: 422 });
    const output = out.ok === false ? (out.output ?? "") : "";
    expect(output).toContain("job Jenkins gagal");
    expect(output).not.toMatch(/\u001b\[/);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "remove", target: "tes-web", exit: 1 }),
    );
  });

  it("ditolak 409 selagi deploy masih berjalan", async () => {
    const dir = await workspace(["tes-web"]);
    let lepas: ((hasil: SpawnResult) => void) | undefined;
    const spawn = vi.fn(() => new Promise<SpawnResult>((resolve) => { lepas = resolve; }));
    const { actions } = make(dir, { spawn });

    const berjalan = actions.run("deploy", "tes-web");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    expect(await actions.remove("tes-web", "tes-web")).toMatchObject({ ok: false, status: 409 });

    lepas?.(result());
    expect(await berjalan).toMatchObject({ ok: true });
  });

  it("menolak 404 untuk app yang tidak ada di registry maupun status", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, spawn } = make(dir);

    await expect(actions.remove("bukan-app", "bukan-app")).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("tetap mencatat audit walau CLI kehabisan waktu sebelum sempat berjalan", async () => {
    const dir = await workspace(["tes-web"]);
    const { actions, audit } = make(dir, {
      spawn: vi.fn(async () => {
        throw Object.assign(new Error("killed"), { code: "ETIMEDOUT" });
      }),
    });

    const out = await actions.remove("tes-web", "tes-web", SESI);

    expect(out).toMatchObject({ ok: false, status: 504 });
    expect(audit).toHaveBeenCalledWith({
      login: "MAliffadlan",
      email: "alif@example.com",
      action: "remove",
      target: "tes-web",
      exit: -1,
    });
  });

  it("menghapus app berbaris registry legacy dua kolom", async () => {
    const dir = await workspace([]);
    await writeFile(join(dir, "registry.tsv"), "app-a\t8000\t8093\nlegacy\t8000\n");
    const { actions, spawn } = make(dir, { listed: [] });

    const out = await actions.remove("legacy", "legacy");

    expect(out).toMatchObject({ ok: true, status: 200, action: "remove", target: "legacy" });
    const [file, args] = spawn.mock.calls[0] as [string, string[]];
    expect(file).toBe(process.env.AUTORE_BIN || "autore");
    expect(args).toEqual(["hapus-app", "legacy", "--konfirmasi", "legacy"]);
  });

  it("menghapus app yang portnya bukan angka", async () => {
    const dir = await workspace([]);
    await writeFile(join(dir, "registry.tsv"), "busuk\tbukan-angka\n");
    const { actions } = make(dir, { listed: [] });

    expect(await actions.remove("busuk", "busuk")).toMatchObject({ ok: true, status: 200 });
  });

  it("menjawab 503 bila registry dan autore status dua-duanya tidak bisa diperiksa", async () => {
    const dir = await workspace([]);
    const spawn = vi.fn(async () => result());
    const actions = hatchActions({
      workspace: dir,
      run: async () => {
        throw new Error("autore tidak bisa dipanggil");
      },
      spawn,
    });

    await expect(actions.remove("app-a", "app-a")).resolves.toMatchObject({ ok: false, status: 503 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("menjawab 503 bila registry tidak terbaca walau status berhasil", async () => {
    const dir = await workspace([]);
    // Direktori bernama registry.tsv: readFile melempar EISDIR, bukan ENOENT —
    // berkas yang gagal dibaca tidak boleh dianggap "tidak ada app".
    await mkdir(join(dir, "registry.tsv"));
    const { actions, spawn } = make(dir);

    await expect(actions.remove("hantu", "hantu")).resolves.toMatchObject({ ok: false, status: 503 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("tetap 404 bila registry terbaca dan app memang tidak ada di keduanya", async () => {
    const dir = await workspace([]);
    await writeFile(join(dir, "registry.tsv"), "app-a\t8000\t8093\n");
    const { actions, spawn } = make(dir);

    await expect(actions.remove("hantu", "hantu")).resolves.toMatchObject({ ok: false, status: 404 });
    expect(spawn).not.toHaveBeenCalled();
  });
});
