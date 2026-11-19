# Sambungkan Repo (Connect) — Onboarding Repo Manual Lewat Web

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dev bisa mendaftarkan repo GitHub yang sudah dia buat sendiri ke Autore hanya dengan mengisi form di dashboard — tanpa terminal, tanpa quick-start yang membuat repo baru.

**Architecture:** Satu subcommand baru `autore connect` menjalankan alur yang selama ini manual (`git clone` → tulis `Dockerfile`/`Jenkinsfile` yang belum ada → commit → push → daftar job Jenkins). Dashboard memanggilnya lewat `/api/actions/connect`, mengikuti pola `quick-start` yang sudah ada (argv array, `shell: false`, kunci per aplikasi, audit dari sesi).

**Tech Stack:** Rust CLI (`cli/`, clap + `std::process::Command`), Hono API (`web/apps/api/`, Vitest), Next.js dashboard (`web/apps/dashboard/`, Vitest + Testing Library).

**Spec:** tidak ada dokumen spec terpisah; kebutuhan berasal dari permintaan user: "dev mau manual tapi tidak mau lewat terminal, cukup klik di web". Keputusan desain ada di plan ini.

## Status

- **Task 1 + 2: SELESAI** (commit `50673a2`, laptop `~/Autore`). 5 tes baru lulus, 321 tes unit lulus, `clippy -D warnings` bersih. Uji nyata: clone + generate + push ke `tugure-reasuransi/autore-demo` sukses (commit `45dbace`); tahap Jenkins berhenti karena laptop tidak punya `jenkins.conf` (Jenkins ada di VPS).
- **Task 3–7: belum dikerjakan.**
- Penyimpangan dari rencana awal, sudah diterapkan di kode:
  - Task 1 dan 2 digabung jadi satu commit: `clippy -D warnings` menolak fungsi yang belum dipakai, jadi commit Task 1 sendirian akan merah.
  - `git_push_branch` tidak ditambahkan ke `main.rs`; fungsi `push_branch` ada di `connect.rs` (`git push -q origin HEAD:<branch>`).
  - `jenkins::ensure_git_committed_and_remote` **tidak** dipakai: fungsi itu menjalankan `git branch -M main` dan akan mengganti nama branch repo dev. Sebagai gantinya `commit_scaffold` di `connect.rs` (add + commit, branch dibiarkan apa adanya).
  - `ensure_jenkins_config` di `main.rs` diubah jadi `pub(crate)` supaya bisa dipanggil dari `connect.rs`.
- Catatan lapangan: `workspace::catat_port` memperingatkan bila folder workspace belum ada (di laptop `~/autore-workspace` belum ada). Di VPS folder itu ada. Bukan penghalang, tapi pesan warning itu sebaiknya tidak muncul di dialog dashboard.

## Global Constraints

- Argv selalu array, `shell: false`; teks dari browser tidak pernah masuk argv selain nilai yang sudah lolos regex/whitelist di server.
- `GIT_TERMINAL_PROMPT=0` di setiap spawn git dari API (tanpa TTY, git tidak boleh menggantung).
- Identitas author commit berasal dari sesi dashboard (`--author-name`/`--author-email`), bukan body request.
- Timeout aksi `connect` = 180 000 ms (sama dengan `quick-start`), `maxBuffer` 1 MiB, output dipotong 4 000 char.
- Path aplikasi wajib satu tingkat di bawah `AUTORE_WORKSPACE`; nama app wajib cocok `^[a-z0-9][a-z0-9_-]{0,62}$`.
- Host repo yang diterima hanya `https://github.com/<owner>/<name>` (dengan `.git` opsional). Tolak ssh, `file://`, host lain, dan URL yang memuat kredensial.
- Tidak ada dependency baru. Komentar kode berbahasa Indonesia dan menjelaskan WHY, bukan WHAT.
- Alur `connect` non-interaktif saat dipanggil dashboard: tidak ada prompt, tidak ada `ui_ask_*`; kekurangan konfigurasi = keluar 1 dengan pesan yang tampil di dialog.
- Gagal di tahap mana pun = fail-closed: keluar bukan-nol, jangan lanjut ke tahap berikutnya.

## Review Focus

1. Repo private atau token tidak punya akses → `git clone` gagal 128; pesan harus menyebut repo tidak bisa diakses, bukan dump stderr mentah.
2. Repo sudah punya `Dockerfile`/`Jenkinsfile` sendiri → **tidak boleh ditimpa**; pipeline milik dev yang dipakai.
3. Repo memakai branch default selain `main` → clone gagal; pesan menyebut flag `--branch`.
4. Nama app sudah dipakai folder lain di workspace → tolak 409 sebelum clone (jangan tinggalkan folder setengah jadi).
5. Push ditolak (branch protection / non-fast-forward) → jangan kunci port di registry sebelum push sukses, supaya port tidak bocor saat gagal.

---

### Task 1: Modul `connect.rs` — parse URL repo + deteksi stack (SELESAI)

**Files:**
- Create: `cli/src/connect.rs`
- Modify: `cli/src/main.rs` (deklarasi `mod connect;` di bagian `mod` atas)

**Interfaces:**
- Produces:
  - `pub struct RepoRef { pub owner: String, pub name: String, pub url: String }`
  - `pub fn parse_repo_url(input: &str) -> Result<RepoRef, String>`
  - `pub fn deteksi_stack(dir: &Path) -> Option<TechStack>`

- [ ] **Step 1: Tulis tes yang gagal**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terima_url_github_polos_dan_dengan_git() {
        let a = parse_repo_url("https://github.com/tugure-git-intern/autore-demo").unwrap();
        assert_eq!((a.owner.as_str(), a.name.as_str()), ("tugure-git-intern", "autore-demo"));
        let b = parse_repo_url("https://github.com/tugure-git-intern/autore-demo.git").unwrap();
        assert_eq!(b.name, "autore-demo");
        assert_eq!(b.url, "https://github.com/tugure-git-intern/autore-demo");
    }

    #[test]
    fn tolak_host_lain_ssh_dan_kredensial() {
        for buruk in [
            "https://gitlab.com/a/b",
            "git@github.com:a/b.git",
            "https://user:tok@github.com/a/b",
            "file:///tmp/repo",
            "https://github.com/a",
            "",
        ] {
            assert!(parse_repo_url(buruk).is_err(), "harus ditolak: {buruk}");
        }
    }

    #[test]
    fn deteksi_stack_dari_berkas_penanda() {
        let tmp = std::env::temp_dir().join(format!("autore-stack-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        assert_eq!(deteksi_stack(&tmp), None);
        std::fs::write(tmp.join("package.json"), "{}").unwrap();
        assert_eq!(deteksi_stack(&tmp), Some(TechStack::NodeJs));
        std::fs::remove_file(tmp.join("package.json")).unwrap();
        std::fs::write(tmp.join("go.mod"), "module x").unwrap();
        assert_eq!(deteksi_stack(&tmp), Some(TechStack::Go));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd cli && cargo test connect::tests`
Expected: FAIL — `parse_repo_url` / `deteksi_stack` belum ada.

- [ ] **Step 3: Implementasi**

`parse_repo_url` tanpa regex crate: potong prefix `"https://github.com/"`, tolak sisa yang memuat `@`, `:`, atau jumlah segmen ≠ 2; buang akhiran `.git`; validasi tiap segmen `[A-Za-z0-9._-]` dan tidak kosong. `url = format!("https://github.com/{owner}/{name}")`.
`deteksi_stack` urut cek: `go.mod` → `Go`, `pom.xml` | `gradlew` → `Java`, `package.json` → `NodeJs`, `requirements.txt` | `pyproject.toml` | `app.py` | `main.py` → `Python`.

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd cli && cargo test connect::tests`
Expected: PASS 3 tes.

- [ ] **Step 5: Commit**

```bash
git add cli/src/connect.rs cli/src/main.rs
git commit -m "feat(cli): parse URL repo GitHub + deteksi stack untuk alur connect"
```

---

### Task 2: Subcommand `autore connect` (SELESAI)

**Files:**
- Modify: `cli/src/main.rs` (enum `Commands` dekat `QuickStart` ~757; cabang dispatch dekat `Commands::QuickStart` ~1606)
- Modify: `cli/src/connect.rs` (fungsi alur)
- Modify: `cli/src/main.rs` (`git_push_branch` di dekat `git_push_main` ~560)

**Interfaces:**
- Consumes: `parse_repo_url`, `deteksi_stack` (Task 1); `templates::{validate_app_name, generate_project_files_with, InitConfig, TechStack}`; `jenkins::{validasi_author, ensure_git_committed_and_remote, register_and_trigger_jenkins}`; `workspace::{pilih_port, catat_port, workspace_dir}`; `has_existing_pipeline_files`.
- Produces:
  - `fn git_push_branch(dir: &Path, branch: &str) -> bool` (tanpa `--force`)
  - `pub fn jalankan_connect(opts: ConnectOpts) -> i32` dengan `pub struct ConnectOpts { pub repo: String, pub path: PathBuf, pub app_name: Option<String>, pub stack: Option<String>, pub app_port: Option<u16>, pub deploy_port: Option<u16>, pub branch: String, pub author_name: Option<String>, pub author_email: Option<String> }`

- [ ] **Step 1: Tulis tes argv + nama default**

```rust
#[test]
fn connect_tanpa_app_name_memakai_nama_repo() {
    let o = ConnectOpts { repo: "https://github.com/tugure-git-intern/autore-demo".into(),
        path: PathBuf::from("/tmp"), app_name: None, stack: None, app_port: None,
        deploy_port: None, branch: "main".into(), author_name: None, author_email: None };
    assert_eq!(nama_aplikasi_connect(&o).unwrap(), "autore-demo");
}

#[test]
fn connect_menolak_nama_tidak_sah() {
    let o = ConnectOpts { repo: "https://github.com/a/b".into(), path: PathBuf::from("/tmp"),
        app_name: Some("Nama Salah".into()), stack: None, app_port: None, deploy_port: None,
        branch: "main".into(), author_name: None, author_email: None };
    assert!(nama_aplikasi_connect(&o).is_err());
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd cli && cargo test nama_aplikasi_connect`
Expected: FAIL — belum ada `ConnectOpts`/`nama_aplikasi_connect`.

- [ ] **Step 3: Implementasi alur (urutan wajib)**

1. `parse_repo_url(&opts.repo)?` → `RepoRef`.
2. `nama_aplikasi_connect` = `app_name` atau `repo.name`, lalu `validate_app_name`.
3. `target_dir = opts.path.join(&nama)`; kalau sudah ada → error, keluar 1 (jangan clone).
4. `git clone <url> <target_dir>` via `Command::new("git")`, arg array, `GIT_TERMINAL_PROMPT=0`. Gagal → pesan: repo tidak bisa diakses (cek akses/token) atau branch `--branch` salah.
5. `deteksi_stack(&target_dir)`; `--stack` menang; kalau dua-duanya kosong → `TechStack::Python`.
6. `app_port` default `stack.default_port()`; `deploy_port` lewat `workspace::pilih_port`.
7. Kalau `has_existing_pipeline_files(&target_dir)` → cetak "Dockerfile/Jenkinsfile milik repo dipakai apa adanya" dan **jangan** generate. Kalau tidak → `generate_project_files_with(&cfg, &target_dir, false)`.
8. `commit_scaffold(&target_dir, author.as_ref())` — add + commit saja; branch repo tidak di-rename.
9. `push_branch(&target_dir, &opts.branch)`; gagal → keluar 1 **sebelum** `catat_port`.
10. `workspace::catat_port(...)`; `ensure_jenkins_config(&conf_path, interactive, false)` (sama seperti `quick-start`) → gagal konfigurasi = keluar 1.
11. `jenkins::register_and_trigger_jenkins(&jk_cfg, &nama, &format!("{}.git", rr.url), &opts.branch)`.
12. Panggil `progress::tahap(...)` pada tiap tahap (`klon`, `kerangka`, `kirim`, `jenkins`) — dashboard membaca progres dari itu saat `AUTORE_PROGRESS=json`.
13. Cetak ringkasan bergaya `quick-start` dan **wajib** memuat baris `• Repo GitHub <owner>/<nama>` supaya `repoDariOutput` di API mengenalinya.
14. Non-interaktif (dipanggil dashboard): tidak boleh ada prompt. Token/Jenkins yang belum tersedia = error keluar 1 dengan pesan yang bisa dibaca di dialog.

- [ ] **Step 4: Jalankan tes**

Run: `cd cli && cargo test connect`
Expected: PASS.

- [ ] **Step 5: Verifikasi manual terhadap repo uji**

Run: `cd /tmp && autore connect --repo https://github.com/tugure-git-intern/autore-demo --path /tmp --branch main`
Expected: folder `/tmp/autore-demo` berisi `Dockerfile` + `Jenkinsfile`, push sukses, job Jenkins dibuat, ringkasan memuat `Repo GitHub tugure-git-intern/autore-demo`.

- [ ] **Step 6: Commit**

```bash
git add cli/src/main.rs cli/src/connect.rs
git commit -m "feat(cli): autore connect — daftarkan repo yang sudah ada tanpa bikin repo baru"
```

---

### Task 3: Validasi body `connect` di API

**Files:**
- Create: `web/apps/api/src/connect.ts`
- Test: `web/apps/api/src/connect.test.ts`

**Interfaces:**
- Consumes: `Identitas` dari `./session`.
- Produces:
  - `export const STACK_SAH_CONNECT = ["python", "nodejs", "java", "go"] as const`
  - `export type ConnectInput = { repo: string; nama: string; stack: Stack; deployPort?: number }`
  - `export function bacaBodyConnect(body: unknown): { ok: true; nilai: ConnectInput } | { ok: false; error: string }`
  - `export function argvConnect(workspace: string, input: ConnectInput, author?: Identitas): string[]`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test("menerima body sah dan menyusun argv tanpa shell", () => {
  const baca = bacaBodyConnect({ repo: "https://github.com/tugure-git-intern/autore-demo", nama: "autore-demo", stack: "nodejs" });
  expect(baca.ok).toBe(true);
  if (!baca.ok) return;
  expect(argvConnect("/w", baca.nilai)).toEqual([
    "connect", "--path", "/w", "--repo", "https://github.com/tugure-git-intern/autore-demo",
    "--app-name", "autore-demo", "--stack", "nodejs",
  ]);
});

test("menolak host lain, kredensial di URL, dan kunci asing", () => {
  expect(bacaBodyConnect({ repo: "https://gitlab.com/a/b", nama: "a", stack: "go" }).ok).toBe(false);
  expect(bacaBodyConnect({ repo: "https://u:p@github.com/a/b", nama: "a", stack: "go" }).ok).toBe(false);
  expect(bacaBodyConnect({ repo: "https://github.com/a/b", nama: "a", stack: "go", ekstra: 1 }).ok).toBe(false);
  expect(bacaBodyConnect({ repo: "https://github.com/a/b", nama: "A B", stack: "go" }).ok).toBe(false);
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/api/src/connect.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi** — pola sama dengan `quick-start.ts`: `KUNCI_BODY = new Set(["repo","nama","stack","deployPort"])`, kunci asing ditolak, `NAMA_APP` regex identik, URL divalidasi regex `^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?$` dan `.git` dibuang sebelum masuk argv, `deployPort` opsional integer 1024–65535. `argvConnect` menambah `["--repo", repo, "--app-name", nama, "--stack", stack]`, `--deploy-port` hanya kalau ada, lalu `--author-name`/`--author-email` dari `author`.

- [ ] **Step 4: Jalankan tes**

Run: `cd web && npx vitest run apps/api/src/connect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/apps/api/src/connect.ts web/apps/api/src/connect.test.ts
git commit -m "feat(api): validasi + argv untuk aksi connect"
```

---

### Task 4: Aksi `connect` di API

**Files:**
- Modify: `web/apps/api/src/actions.ts` (`ActionKind` ~25, `TIMEOUT` ~47, fungsi baru di dalam `hatchActions`, return ~akhir)
- Modify: `web/apps/api/src/index.ts` (route sesudah `/api/actions/quick-start` ~311)
- Modify: `web/apps/api/src/actions.test.ts`, `web/apps/api/src/index.test.ts`

**Interfaces:**
- Consumes: `bacaBodyConnect`, `argvConnect` (Task 3); `spawnAutore`, `capped`, `failed`, `catatKeRegistry`, `ambilKunci`, `pemegangKunci`, `aksiBerjalan`, `repoDariOutput`.
- Produces: `ActionKind` memuat `"connect"`; `Actions` memuat `connect(input: ConnectInput, author?: Identitas): Promise<ActionResult>`.

- [x] **Step 1: Tulis tes yang gagal** — di `actions.test.ts`: spawn dipanggil dengan argv hasil `argvConnect`, `GIT_TERMINAL_PROMPT: "0"`, `AUTORE_PROGRESS: "json"`, timeout 180 000; exit ≠ 0 → `422`; lock aplikasi lain → `409`; `audit` mencatat `action: "connect"`. Di `index.test.ts`: `POST /api/actions/connect` body salah → `400`, body sah → `200 { ok: true, action: "connect", repo }`.

- [x] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts apps/api/src/index.test.ts`
Expected: FAIL.

- [x] **Step 3: Implementasi** — salin bentuk `quickStart`: cek `workspace`, cek `aksiBerjalan()`, cek folder `workspace/<nama>` belum ada (`409`), `ambilKunci(nama, "connect")`, spawn, `catatKeRegistry`, `resetStatusCache`, `audit({ action: "connect" })`, sukses → `{ ok: true, status: 200, action: "connect", target: nama, repo: repoDariOutput(output), output }`. Route di `index.ts` mengikuti handler quick-start (sesi diteruskan, `Cache-Control: no-store`).

- [x] **Step 4: Jalankan tes**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts apps/api/src/index.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/api/src/actions.ts web/apps/api/src/actions.test.ts web/apps/api/src/index.ts web/apps/api/src/index.test.ts
git commit -m "feat(api): aksi connect + route /api/actions/connect"
```

---

### Task 5: Dialog "Sambungkan Repo" di dashboard

**Files:**
- Create: `web/apps/dashboard/src/lib/connect-client.ts`, `web/apps/dashboard/src/lib/connect-client.test.ts`
- Create: `web/apps/dashboard/src/components/actions/connect-dialog.tsx`, `.../connect-dialog.test.tsx`
- Modify: `web/apps/dashboard/src/app/applications/page.tsx`

**Interfaces:**
- Produces: `runConnect(input: { repo: string; nama: string; stack: Stack }): Promise<{ ok: boolean; message: string; repo?: string }>`; komponen `<ConnectDialog onDone={() => void} />`.

- [x] **Step 1: Tulis tes yang gagal** — client mengirim `POST /api/actions/connect` dengan body `{repo,nama,stack}` dan meneruskan pesan error server; dialog: tombol "Sambungkan Repo" membuka form 3 kolom, kolom kosong menonaktifkan submit, konfirmasi kedua wajib (`Sambungkan sekarang`) sebelum memanggil `runConnect`.

- [x] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/dashboard/src/lib/connect-client.test.ts apps/dashboard/src/components/actions/connect-dialog.test.tsx`
Expected: FAIL.

- [x] **Step 3: Implementasi** — `connect-client.ts` meniru `quick-start-client.ts` (satu `fetch`, tanpa `shell`), `connect-dialog.tsx` meniru `quick-start-dialog.tsx` (field: URL repo placeholder `https://github.com/<owner>/<repo>`, nama aplikasi, pilihan stack; pesan konfirmasi menyebut bahwa repo akan di-clone, ditambah `Dockerfile`/`Jenkinsfile` bila belum ada, lalu di-push). Tempatkan tombol **Sambungkan Repo** tepat di samping tombol Quick Start di `applications/page.tsx`.

- [x] **Step 4: Jalankan tes**

Run: `cd web && npx vitest run apps/dashboard/src/lib/connect-client.test.ts apps/dashboard/src/components/actions/connect-dialog.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/lib/connect-client.ts web/apps/dashboard/src/lib/connect-client.test.ts web/apps/dashboard/src/components/actions/connect-dialog.tsx web/apps/dashboard/src/components/actions/connect-dialog.test.tsx web/apps/dashboard/src/app/applications/page.tsx
git commit -m "feat(dashboard): dialog Sambungkan Repo di halaman Applications"
```

---

### Task 6: Dokumentasi + regresi penuh

**Files:**
- Modify: `README.md` (tabel `CLI Reference`, sisi `autore deploy`)
- Modify: `web/README.md` (bagian aksi dashboard)

- [x] **Step 1: Tambah baris dokumentasi** — README: `| \`autore connect\` | Men-clone repo GitHub yang sudah ada, menambahkan \`Dockerfile\`/\`Jenkinsfile\` bila belum ada, commit+push, lalu mendaftarkan job Jenkins (\`--repo\`, \`--branch\`, \`--stack\`). | Manual onboarding |`. `web/README.md`: satu paragraf bahwa dashboard punya dua jalur onboarding — Quick Start (buat repo baru) dan Sambungkan Repo (repo yang sudah ada).

- [x] **Step 2: Regresi penuh**

Run: `cd cli && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: PASS tanpa warning.
Run: `cd web && npm test && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add README.md web/README.md
git commit -m "docs: jalur onboarding Sambungkan Repo (autore connect)"
```

---

### Task 7: Quick Start bisa membuat repo di organisasi

Konteks: org `tugure-reasuransi` sudah dibuat. `github::ensure_repo` saat ini selalu `POST /user/repos`, jadi repo baru lahir di akun pemilik token, bukan di org. Alur `connect` (Task 1–6) tidak perlu diubah — owner sudah ikut dari URL repo.

**Files:**
- Modify: `cli/src/github.rs` (`ensure_repo` ~177, `ensure_repo_dengan` ~181)
- Modify: `cli/src/main.rs` (flag `QuickStart` ~757; pemanggilan `ensure_repo` di cabang quick-start ~1857)
- Modify: `web/apps/api/src/quick-start.ts` (`KUNCI_BODY`, `bacaBodyQuickStart`, `argvQuickStart`)
- Modify: `web/apps/dashboard/src/components/actions/quick-start-dialog.tsx`, `web/apps/dashboard/src/lib/quick-start-client.ts`
- Test: `cli/src/github.rs` (mod tests), `web/apps/api/src/quick-start.test.ts`

**Interfaces:**
- Produces: `pub fn ensure_repo(token: &str, owner: &str, name: &str, org: Option<&str>) -> Result<(String, bool), String>` — endpoint `POST /orgs/{org}/repos` bila `org` ada, selain itu `POST /user/repos`; `full` tetap `format!("{owner}/{name}")` dengan `owner` = `org` bila ada.
- Produces: flag `autore quick-start --org <nama>`; body API menerima kunci opsional `org`; argv menambah `--org <nama>` hanya bila diisi.

- [ ] **Step 1: Tulis tes yang gagal** — di `github.rs`: dengan lapisan HTTP suntikan, `ensure_repo_dengan(..., Some("tugure-reasuransi"))` pada repo yang belum ada harus mengirim `POST /orgs/tugure-reasuransi/repos` dan mengembalikan `("tugure-reasuransi/app", true)`; dengan `None` tetap `POST /user/repos`. Di `quick-start.test.ts`: body `{nama,stack,org:"tugure-reasuransi"}` lolos dan `argvQuickStart` memuat `"--org","tugure-reasuransi"`; `org:"nama buruk!"` ditolak.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd cli && cargo test ensure_repo`
Run: `cd web && npx vitest run apps/api/src/quick-start.test.ts`
Expected: FAIL — parameter `org` dan kunci body belum ada.

- [ ] **Step 3: Implementasi** — tambah parameter `org: Option<&str>` pada kedua fungsi, perbarui pemanggil di `main.rs` dan tes lama; pilih endpoint dengan `match org`. Nama org divalidasi pola yang sama dengan owner (`^[A-Za-z0-9._-]+$`). `KUNCI_BODY` API tambah `"org"` (opsional), `argvQuickStart` menambah `--org` hanya bila ada. Dialog dashboard: satu kolom opsional **Organisasi** dengan placeholder `tugure-reasuransi`.

- [ ] **Step 4: Jalankan tes**

Run: `cd cli && cargo test && cargo clippy --all-targets -- -D warnings`
Run: `cd web && npm test && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 5: Verifikasi manual**

Run: `autore quick-start --app-name uji-org --stack python --org tugure-reasuransi --deploy-port 8175`
Expected: repo `tugure-reasuransi/uji-org` dibuat (bukan di akun pribadi), build jalan. Kalau token bukan anggota org atau kurang scope, error menyebut izin org — bukan pesan umum.

- [ ] **Step 6: Commit**

```bash
git add cli/src/github.rs cli/src/main.rs web/apps/api/src/quick-start.ts web/apps/api/src/quick-start.test.ts web/apps/dashboard/src/components/actions/quick-start-dialog.tsx web/apps/dashboard/src/lib/quick-start-client.ts
git commit -m "feat: quick-start bisa membuat repo di GitHub organization (--org)"
```

---

## Setelah plan ini selesai

- Deploy API + dashboard ke VPS (`systemctl --user restart autore-api autore-dashboard` atau unit yang dipakai), lalu `autore` binary di VPS diperbarui dari rilis/Autore CLI build.
- Uji end-to-end: repo `tugure-git-intern/autore-demo` → dashboard → Sambungkan Repo → build jalan → release muncul untuk approve.
- Catatan jujur untuk demo: repo harus publik atau server harus punya token/deploy key ke repo itu; push balik dari server berarti server butuh izin tulis (quick-start sekarang pun begitu).
