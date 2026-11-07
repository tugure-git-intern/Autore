# Plan: Admin Commands & Aliases (Autore CLI)

Status: **DIEKSEKUSI (T1–T6 hijau, 2026-11-07). Belum di-commit** — menunggu uji manual bos alif.
Tanggal: 2026-11-07
Repo: `~/Autore` di VPS (`vps`, tailnet `100.80.3.14`, user `tugure`), crate ada di `cli/`.

## Tujuan

Tim IT bisa mengelola dua layanan dashboard tanpa mengetik `systemctl` panjang:

| Perintah | Efek |
|---|---|
| `autore start` | satu panggilan `systemctl --user start autore-web-api autore-web-dashboard` |
| `autore stop` | satu panggilan `systemctl --user stop ...` |
| `autore restart` | satu panggilan `systemctl --user restart ...` |
| `autore logs` | `journalctl --user -u autore-web-api -u autore-web-dashboard -f` (real-time) |
| `autore st` | alias `status` |
| `autore dep` | alias `deploy` |
| `autore qs` | alias `quick-start` |
| `autore doc` | alias `doctor` |
| `autore in` | alias `init` |
| `autore` → `[4] Admin` | sub-menu Start / Stop / Restart / Logs |

Kalau `systemctl` tidak ada (macOS / kontainer / WSL tanpa bus): pakai jalur cadangan berbasis PID + berkas log yang sudah ditulis `launcher.rs` (`~/.local/state/autore/api.pid`, `dashboard.pid`, `api.log`, `dashboard.log`).

## Baseline terukur (2026-11-07, VPS, biner `0.5.8`)

```
cd ~/Autore/cli && export PATH=$HOME/.cargo/bin:$PATH
cargo test --bin autore          -> 263 passed; 0 failed
cargo test --test launcher_cli   -> 5 passed
cargo test --test sbom_cli       -> MERAH (1 tes, cacat lama, bukan dari pekerjaan ini)
```

RED yang sudah diukur hari ini pada biner nyata (bukan perkiraan):

```
./target/release/autore st      -> error: unrecognized subcommand 'st'      exit=2
                                    tip: a similar subcommand exists: 'status'
./target/release/autore start   -> error: unrecognized subcommand 'start'   exit=2
./target/release/autore logs    -> error: unrecognized subcommand 'logs'    exit=2
./target/release/autore qs      -> error: unrecognized subcommand 'qs'      exit=2
```

Artinya: tidak ada satu pun fitur yang diminta sudah ada. Nol risiko "ternyata sudah jalan".

## Global Constraints

1. **Tampilan terminal:** ASCII murni, tanpa emoji, bahasa Indonesia formal, minimalis. Sama seperti `launcher.rs` — ditegakkan tes, bukan disiplin manual.
2. **Nol dependency baru.** `clap 4.5` (`cli/Cargo.toml:13`) sudah mendukung `alias`; `inquire` sudah vendored. Tidak ada `clap_complete`, tidak ada crate log.
3. **Tidak menyentuh `cli/src/tui.rs`** (1867 baris, TUI legacy). Menu Admin masuk ke menu `autore` (fitur Friendly Launcher), bukan ke TUI legacy — kecuali bos alif memilih lain (pertanyaan 1).
4. **Tidak menurunkan gerbang keamanan** dan tidak menyentuh `web/`, `vars/`, `Jenkinsfile`.
5. **Berkas yang disentuh (butuh izin, pertanyaan 5):**
   - BARU `cli/src/admin.rs`
   - BARU `cli/tests/admin_cli.rs`
   - UBAH `cli/src/main.rs` (enum `Commands`, dispatch, menu `[4]`)
   - UBAH `cli/src/launcher.rs` (trait `Sistem` +2 method, `OPSI` jadi 4, rentang `baca_pilihan`, teks pesan, `panduan_subcommand`)
   - UBAH `README.md` (tabel CLI Reference sekitar baris 185)
6. **`cargo test --bin autore` 100% hijau sebelum commit.** `sbom_cli` yang merah dicatat sebagai cacat lama; gate per task menyebut berkas tes yang dijalankan, dan gate akhir menjalankan seluruh `cargo test` lalu melaporkan angka apa adanya.
7. Jangan `cargo fmt` repo-wide (merusak ~15 berkas). Kalau perlu format: `rustfmt --edition 2021 src/admin.rs` saja.
8. Commit lokal sesudah gate hijau; **`git push` baru setelah bos alif uji manual dan bilang OK** (aturan yang sama dengan Friendly Launcher).

## Keputusan desain

**D1 — Satu seam `Sistem` diperluas, bukan trait baru.**
`launcher::Sistem` (`cli/src/launcher.rs:25`) sudah jadi pintu tunggal ke mesin (systemctl, port, IP, nohup, state dir). Admin menambah **2 method** saja:

```rust
/// Jalankan program dengan stdio warisan (log real-time). Mengembalikan kode keluar.
fn warisi(&self, program: &str, argumen: &[String]) -> Result<i32, String>;
/// Kirim SIGTERM (jalur tanpa systemd).
fn hentikan(&self, pid: u32) -> Result<(), String>;
```

Alasan: `systemctl start/stop/restart`, `journalctl -f`, dan `tail -f` semuanya "jalankan program, teruskan keluaran, ambil kode" — satu method menutup tiga kebutuhan, dan argv-nya jadi fungsi murni yang bisa dites tanpa proses. `SistemNyata` (`:257`) + `SistemPalsu` (di modul tes `:532`) mengimplementasikan keduanya.
`ponytail:` batasnya — `warisi` tidak menangkap stdout, jadi tes integrasi membaca keluaran lewat `Command::output()` biner, bukan lewat trait. Kalau suatu saat butuh parsing keluaran `systemctl`, tambah `warisi_tangkap` saat itu.

**D2 — Argv dibangun fungsi murni, dieksekusi lewat seam.**

```rust
fn argv_systemctl(aksi: &str, units: &[&str]) -> Vec<String>  // ["--user","start","autore-web-api","autore-web-dashboard"]
fn argv_journal(units: &[&str], follow: bool, lines: usize) -> Vec<String>
fn argv_tail(berkas: &[PathBuf], follow: bool, lines: usize) -> Vec<String>
```

Alasan: 80% risiko fitur ini ada di argv yang salah (`-u` dua kali, `--user` hilang, `-f` nyangkut di mode tes), dan itu bisa dites tanpa spawn. `ponytail:` belum ada `--since`/`--priority`; tambah kalau tim IT minta filter.

**D3 — Menu: `[4] Admin`, `[3] Keluar` tetap di posisinya.**
Permintaan bos alif menyebut "opsi [4] Admin", jadi Admin **ditambahkan** di ekor; label `[1]`–`[3]` tidak bergeser. Efek samping bagus: tes integrasi launcher yang sudah hijau (`pilihan_3_keluar_bersih`) tetap sah, dan tidak ada tes lama yang perlu diubah artinya.
`ponytail:` `Keluar` jadi tidak paling bawah. Kalau terasa janggal, tukar jadi `[3] Admin`/`[4] Keluar` — 2 baris + 1 tes, sekarang belum perlu.

**D4 — Sub-menu Admin berputar sampai `Kembali`.**
Opsinya `[1] Start`, `[2] Stop`, `[3] Restart`, `[4] Logs`, `[5] Kembali`. Sesudah satu aksi, menu tampil lagi supaya alur "start lalu lihat log" tidak perlu keluar-masuk. Aksi yang gagal mencetak `[!] ...` dan **tidak** mematikan sub-menu; kode keluar sub-menu = kode aksi terakhir.

**D5 — Jalur tanpa systemd: PID, bukan poll kesiapan.**
`start` = `jalankan_latar` untuk `npm run start:api` dan `npm run start:dashboard` (menulis `api.pid`/`dashboard.pid`, sama seperti `launcher.rs:112–127`). `stop` = baca PID, `hentikan`, hapus berkas PID. `restart` = stop lalu start. `logs` = `tail -n N [-f] api.log dashboard.log`.
Alasan: poll kesiapan 15 detik sudah ada di jalur launcher; menduplikasinya di sini membuat tiap `autore start` menahan shell 15 detik dan membuat tes integrasi lambat/rapuh. `ponytail:` admin tanpa systemd tidak memverifikasi dashboard benar-benar hidup — itu tugas `autore` (tanpa argumen) → `[1]`.

**D6 — Deteksi tanpa systemd bisa dipaksa lewat env khusus tes.**
`SistemNyata::systemctl_ada()` membaca `AUTORE_TANPA_SYSTEMD=1` lebih dulu. Alasan: tes integrasi tidak bisa menghapus `/usr/bin/systemctl` dari PATH tanpa juga kehilangan `sh`/`nohup` yang dipakai jalur nohup. Presedennya sudah ada (`AUTORE_MENU_PILIHAN`, `launcher.rs:6`). Env ini tersembunyi dari `--help`.

**D7 — `logs` default follow, `--no-follow` untuk berhenti.**
`follow = !no_follow`. Tidak ada deteksi TTY otomatis: `autore logs` yang dipipe tetap mengikuti (arti `-f`), dan `Ctrl-C`/`--no-follow` menghentikannya. `ponytail:` pipa yang tak pernah tutup adalah perilaku `journalctl -f` itu sendiri; deteksi TTY ditambahkan kalau ada yang mengeluh.

**D8 — Alias memakai `visible_alias`.**
Permintaan bos alif menulis `#[command(alias = "...")]`, tapi `alias` **tidak tampil** di `--help` sehingga tidak ada yang tahu `st`/`dep`/`qs`/`doc`/`in` ada. `visible_alias` menerima input yang sama dan menampilkannya di bantuan. Kalau mau persis `alias` (sembunyi), tinggal ganti atributnya — 5 baris (pertanyaan 2).

**D9 — Penjaga pengguna sama dengan launcher.**
`autore start|stop|restart|logs` menolak bila `pengguna != AUTORE_WEB_USER` (default `tugure`) dengan `[!] Akses ditolak. Silakan jalankan sebagai user yang sesuai.` (fungsi `launcher::pesan_akses_ditolak`, dijadikan `pub(crate)`). Alasan: unit systemd ini milik user manager `tugure`; dari akun lain `systemctl --user` menunjuk user manager yang salah dan pesan galatnya menyesatkan.

## Task 1 — `admin.rs`: aksi, label, dan argv murni

### RED
Berkas `cli/src/admin.rs` belum ada.

```
cargo test --bin autore admin
```
harus gagal kompilasi: `error[E0583]: file not found for module 'admin'` (setelah `mod admin;` ditambahkan ke `main.rs` dengan badan kosong, RED-nya berubah jadi `panicked at 'assertion failed'`). Tes yang ditulis lebih dulu:

1. `judul_admin_dan_lima_opsi` — `JUDUL_ADMIN == "Autore - Menu Admin"`, `OPSI_ADMIN` = `["[1] Start","[2] Stop","[3] Restart","[4] Logs","[5] Kembali"]`.
2. `nama_aksi_dikenali` — `Aksi::dari_nama("start"|"stop"|"restart"|"logs")` benar; `"mulai"` → `None`.
3. `pilihan_aksi_1_sampai_4` — `1..=4` → `Some`, `5` → `None` (Kembali).
4. `argv_systemctl_dua_unit_satu_panggilan` — `argv_systemctl("start", &["autore-web-api","autore-web-dashboard"])` == `["--user","start","autore-web-api","autore-web-dashboard"]`.
5. `semua_pesan_admin_ascii` — seluruh label + pesan lolos `is_ascii()`, nol emoji.

### GREEN
`cli/src/admin.rs` baru: `JUDUL_ADMIN`, `OPSI_ADMIN`, `enum Aksi { Start, Stop, Restart, Logs }`, `impl Aksi { fn dari_nama(&str) -> Option<Aksi>; fn dari_pilihan(usize) -> Option<Aksi>; fn nama_systemctl(&self) -> &'static str }`, `fn argv_systemctl(...)`, `fn pesan_pilihan_tidak_dikenal_admin(p: usize) -> String` (`"[!] Pilihan tidak dikenal: {p}. Ketik 1 sampai 5."`).

### GATE
```
cargo test --bin autore admin       -> 5 passed
cargo clippy --all-targets -- -D warnings   -> 0 error (berkas baru bebas warning)
```

### COMMIT
`feat(cli): modul admin — aksi, label sub-menu, argv systemctl`

## Task 2 — Penjaga pengguna + jalur systemd (start/stop/restart)

### RED
Tes baru (semua memakai `SistemPalsu`):

1. `pengguna_lain_ditolak_tanpa_menyentuh_sistem` — `pengguna="mectov"` → `jalankan(...) == 1`, keluaran memuat `[!] Akses ditolak.`, `warisi` **tidak pernah** dipanggil.
2. `start_memanggil_systemctl_sekali_dua_unit` — tepat satu panggilan `warisi("systemctl", ["--user","start","autore-web-api","autore-web-dashboard"])`.
3. `stop_dan_restart_memakai_aksi_benar` — `["--user","stop",...]` dan `["--user","restart",...]`.
4. `sesudah_start_cetak_status_kedua_unit` — status palsu `["active","active"]` → `[OK] autore-web-api: aktif` + `[OK] autore-web-dashboard: aktif`.
5. `systemctl_gagal_exit_1` — `warisi` → `Ok(1)` → keluaran `[!] Gagal menjalankan systemctl --user start autore-web-api autore-web-dashboard (kode 1).`, `jalankan(...) == 1`.

RED terukur untuk tes 2 sebelum kode ada: `panicked at src/admin.rs:NN: no method named 'warisi' found for struct 'SistemPalsu'` (trait belum diperluas) → lalu `assertion failed: sis.warisi_calls.borrow().is_empty()`.

### GREEN
`cli/src/launcher.rs`: tambah `warisi` + `hentikan` ke trait `Sistem` (`:25`), implementasi di `SistemNyata` (`Command::new(program).args(...).status()`, `kill -TERM <pid>`) dan stub di `SistemPalsu` (rekam panggilan).
`cli/src/admin.rs`: `pub fn jalankan(sis: &dyn Sistem, aksi: Aksi, keluar: &mut dyn Write) -> i32` — urutan: penjaga pengguna → (Task 4: cabang tanpa systemd) → `warisi("systemctl", argv_systemctl(...))` → kalau kode 0, cetak status kedua unit lewat `sis.status(...)` lalu `0`; selain itu `[!] ...` lalu `1`.

### GATE
```
cargo test --bin autore admin       -> 10 passed
cargo test --bin autore launcher    -> 32 passed (semua tes launcher lama tetap hijau)
```

### COMMIT
`feat(cli): autore start|stop|restart lewat systemctl --user`

## Task 3 — `autore logs`

### RED
1. `logs_default_follow` — `argv_journal(units, true, 50)` memuat `"--user"`, `"-u autore-web-api"`, `"-u autore-web-dashboard"`, `"-n 50"`, `"--no-pager"`, `"-f"` (urutan: `--user -u A -u B -n 50 --no-pager -f`).
2. `logs_no_follow_tanpa_ef` — `follow=false` → tidak ada `"-f"`, sisa argv sama.
3. `logs_diteruskan_ke_journalctl` — `jalankan(sis, Aksi::Logs { follow: true, lines: 50 })` memanggil `warisi("journalctl", ...)` dan mengembalikan kode dari `warisi` (uji `Ok(0)` → 0 dan `Ok(130)` → 130).

### GREEN
`fn argv_journal(...)`, `Aksi::Logs { follow, lines }`, cabang `Logs` di `jalankan`.

### GATE
```
cargo test --bin autore admin       -> 13 passed
```

### COMMIT
`feat(cli): autore logs (journalctl -f dua unit)`

## Task 4 — Jalur tanpa systemd (fallback macOS)

### RED
Semua memakai `SistemPalsu` dengan `systemctl_ada = false` + `AUTORE_STATE_DIR`/`XDG_STATE_HOME` menunjuk direktori sementara.

1. `tanpa_systemd_start_menjalankan_dua_proses` — `jalankan_latar` dipanggil 2× dengan `(["npm","run","start:api"], api.log, api.pid)` dan `(["npm","run","start:dashboard"], dashboard.log, dashboard.pid)`; keluaran `[i] systemctl tidak tersedia. Memakai jalur tanpa systemd.` + `[OK] npm run start:api: dijalankan di latar (PID N).`; kode 0.
2. `tanpa_systemd_stop_menghabisi_pid_dan_menghapus_berkas` — `api.pid` berisi `4242` di tmpdir → `hentikan(4242)` dipanggil, berkas hilang, `[OK] autore-web-api: dihentikan.`
3. `tanpa_systemd_stop_tanpa_pid_diam_dan_lapor` — tanpa berkas PID → `[i] Tidak ada PID tersimpan untuk autore-web-api.`, `hentikan` tidak dipanggil, kode 0.
4. `tanpa_systemd_restart_stop_lalu_start` — urutan panggilan terbukti (`hentikan` sebelum `jalankan_latar`).
5. `tanpa_systemd_logs_memakai_tail` — `warisi("tail", ["-n","50","-f",api.log,dashboard.log])`; `--no-follow` membuang `-f`.
6. `env_tanpa_systemd_memaksa_jalur_cadangan` — `SistemNyata::systemctl_ada()` mengembalikan `false` saat `AUTORE_TANPA_SYSTEMD=1` walau `systemctl` ada di PATH.

### GREEN
`cli/src/admin.rs`: `fn jalankan_tanpa_systemd(sis, aksi, keluar) -> i32`, `fn pid_dari(berkas: &Path) -> Option<u32>` (fungsi murni: baca + `trim().parse()`), `fn argv_tail(...)`, tabel proses dipindah jadi satu sumber `pub(crate) const PROSES: [(&[&str; 3], &str, &str); 2]` di `launcher.rs` (dipakai `jalankan_tanpa_systemd` launcher + admin — sekarang nama berkas itu masih inline di `launcher.rs:112–127`).
`cli/src/launcher.rs`: `systemctl_ada()` menghormati `AUTORE_TANPA_SYSTEMD`.

### GATE
```
cargo test --bin autore admin       -> 19 passed
cargo test --bin autore launcher    -> 32 passed
```

### COMMIT
`feat(cli): jalur admin tanpa systemd (PID + tail)`

## Task 5 — `main.rs`: subcommand, alias, menu `[4]`, README

### RED
```
./target/release/autore st      -> error: unrecognized subcommand 'st'      exit=2   (terukur)
```
Tes baru:
1. `alias_lima_subcommand_terdaftar` — `Cli::command()`: `status→st`, `deploy→dep`, `quick-start→qs`, `doctor→doc`, `init→in` (lewat `get_all_aliases()`).
2. `subcommand_admin_terdaftar` — `start`, `stop`, `restart`, `logs` ada; `logs` punya `--no-follow` dan `--lines` (dites lewat `render_long_help()`, pola yang sudah dipakai `src/main.rs:2406`).
3. `menu_awal_punya_empat_opsi` — `launcher::OPSI.len() == 4`, entri ke-4 `"[4] Admin"`.
4. `pesan_pilihan_rentang_baru` — `pesan_pilihan_tidak_dikenal(7)` memuat `"Ketik 1, 2, 3, atau 4."` (sekarang masih `"Ketik 1, 2, atau 3."`, `launcher.rs:514`).
5. `panduan_subcommand_menyebut_admin` — `panduan_subcommand()` memuat `"autore start"`, `"autore stop"`, `"autore restart"`, `"autore logs"` (jalur non-TTY).
6. `commands_for` tidak berubah (menu TUI legacy tetap 9 entri) — tes lama `:2345–2364` harus tetap hijau tanpa diubah.

RED terukur untuk tes 1 sebelum kode ada: `assertion failed: aliases contains "st"` (`get_all_aliases()` mengembalikan kosong).

### GREEN
`cli/src/main.rs`:
- `mod admin;`
- `enum Commands`: `Start`, `Stop`, `Restart`, `Logs { #[arg(long)] no_follow: bool, #[arg(long, default_value_t = 50)] lines: usize }`; alias lewat `#[command(visible_alias = "...")]` pada `Init`/`Deploy`/`QuickStart`/`Doctor`/`Status`.
- `match command` (`:942`): empat cabang → `admin::jalankan(&launcher::SistemNyata, ..., &mut std::io::stdout())` → `process::exit(kode)`.
- Blok menu tanpa-subcommand: cabang `4 => process::exit(admin::menu(&launcher::SistemNyata, &mut std::io::stdout()))`.
- `cli/src/launcher.rs`: `OPSI` jadi `[&str; 4]` (`:15`), `baca_pilihan` rentang `1..=4` (`:525`), teks pesan (`:514`), `panduan_subcommand` (`:189`), `pesan_akses_ditolak` jadi `pub(crate)`.
- `cli/src/admin.rs`: `pub fn menu(sis, keluar) -> i32` — env `AUTORE_ADMIN_PILIHAN=1..5` diproses **lebih dulu** (supaya tes bisa menggerakkan sub-menu tanpa TTY), non-TTY tanpa env → `[i] Menu Admin butuh terminal interaktif. Gunakan: autore start|stop|restart|logs.` kode 0; interaktif → `ui_ask_choose` + loop sampai `[5] Kembali`.
- `README.md`: 4 baris baru di tabel CLI Reference (sekitar baris 185) + kolom alias pada 5 perintah yang punya alias.

### GATE
```
cargo test --bin autore             -> 263 + 5 (alias/subcommand) + 6 (menu) passed
cargo build --release --bin autore
./target/release/autore st --json   -> JSON, exit 0        (RED tadi: unrecognized, exit 2)
./target/release/autore --help      -> "start","stop","restart","logs" muncul + kolom alias
./target/release/autore --help | grep -cP "[^\x00-\x7F]"   -> 0
```

### COMMIT
`feat(cli): subcommand admin, alias singkat, menu [4] Admin`

## Task 6 — Tes integrasi biner nyata (`tests/admin_cli.rs`)

### RED
Berkas belum ada. Pola shim mengikuti `tests/launcher_cli.rs:13` (`tulis_shim`) + `:21` (`Shim`): direktori sementara paling depan di PATH, `systemctl`/`journalctl`/`id`/`npm` diganti skrip tiruan yang menuliskan argv-nya ke `$AUTORE_TES_LOG`.

1. `start_memanggil_systemctl_satu_kali_dua_unit` — berkas log shim berisi tepat satu baris `--user start autore-web-api autore-web-dashboard`; exit 0.
2. `stop_dan_restart_aksi_benar` — dua baris, `stop` lalu `restart`.
3. `alias_st_menjalankan_status` — `autore st --json` dengan `AUTORE_WORKSPACE` menunjuk workspace sementara → exit 0, stdout mulai dengan `{`.
4. `pengguna_lain_ditolak_tanpa_memanggil_systemctl` — `AUTORE_WEB_USER=mectov autore restart` → exit 1, berkas log shim **kosong**, keluaran memuat `[!] Akses ditolak.`
5. `logs_no_follow_meneruskan_keluaran_journalctl` — shim `journalctl` mencetak `journalctl-ok` → keluaran `autore logs --no-follow` memuat baris itu; argv shim memuat dua `-u`.
6. `menu_4_lalu_1_menjalankan_start` — `AUTORE_MENU_PILIHAN=4 AUTORE_ADMIN_PILIHAN=1` → sama seperti tes 1.
7. `tanpa_systemd_start_menulis_pid` — `AUTORE_TANPA_SYSTEMD=1`, `AUTORE_WEB_DIR=<tmp berisi package.json>`, `XDG_STATE_HOME=<tmp>`, shim `npm` (`sleep 2`) → `api.pid` dan `dashboard.pid` ada di `<tmp>/autore`; exit 0.

Semua tes memakai `CARGO_BIN_EXE_autore`. Tidak ada tes yang menulis ke state nyata: `XDG_STATE_HOME` selalu dialihkan, `AUTORE_AUDIT_LOG` tidak relevan (tidak ada jalur audit di CLI).

### GREEN
`cli/tests/admin_cli.rs` (~150 baris). Shim `systemctl` wajib menangani tiga bentuk yang dipakai kode: `--user start|stop|restart <unit...>` (catat argv, exit 0) dan `--user is-active <unit>` (cetak `active`) karena `jalankan` mencetak status sesudah aksi.

### GATE — gerbang akhir
```
cd ~/Autore/cli && export PATH=$HOME/.cargo/bin:$PATH
cargo test --test admin_cli        -> 7 passed
cargo test --bin autore            -> semua hijau
cargo test --test launcher_cli     -> 5 passed
cargo test --test scan_cli         -> hijau
cargo test                         -> hijau kecuali sbom_cli (1 tes, cacat lama)
grep -nP "[^\x00-\x7F]" src/admin.rs tests/admin_cli.rs   -> kosong
cd ~/Autore/web && npx vitest run  -> tidak dijalankan: tidak ada berkas web yang disentuh
```

### COMMIT
`test(cli): tes integrasi admin commands dan alias`

## Ringkasan RED → GREEN

| Task | Perubahan | Tes baru | RED (terukur/terprediksi) |
|---|---|---|---|
| T1 | `admin.rs` label + argv | 5 unit | `unrecognized subcommand '...'` (terukur) → modul kosong |
| T2 | penjaga + jalur systemd | 5 unit | `no method named 'warisi' found` |
| T3 | `logs` + argv journal | 3 unit | `no method named 'warisi'` |
| T4 | jalur tanpa systemd | 6 unit | `assertion failed: hentikan_calls.is_empty()` |
| T5 | subcommand, alias, menu `[4]`, README | 6 unit | `assertion failed: aliases contains "st"` |
| T6 | tes integrasi biner | 7 integrasi | berkas tes belum ada |

Total: **+32 tes**, target `cargo test --bin autore` 263 → 295.

## Yang sengaja TIDAK dikerjakan

- Entri Admin di menu TUI legacy (`MENU` 9 entri, `main.rs:378`) — pertanyaan 1.
- `--json` untuk `autore start|stop|restart|logs`.
- Watchdog / auto-restart unit, `systemd-run`, timer.
- Dukungan mesin jarak jauh (`ssh vps autore start`) — sekarang hanya mesin lokal.
- `--since`/`--until`/`--priority` pada `logs`.
- Retrofit ASCII berkas lama (`doctor.rs` masih punya `✔`/`✘`) — masih utang dari fase sebelumnya.
- Memperbaiki `cli/tests/sbom_cli.rs` yang merah (cacat lama, di luar izin berkas).

## Cara uji manual di VPS (setelah eksekusi)

```bash
cd ~/Autore/cli && export PATH=$HOME/.cargo/bin:$PATH
cargo build --release --bin autore
install -m755 target/release/autore ~/.local/bin/autore
sudo install -m755 target/release/autore /usr/local/bin/autore
~/.local/bin/autore --version && /usr/local/bin/autore --version

autore --help                  # cek 4 subcommand baru + alias
autore st                      # alias harus jalan seperti autore status
autore restart                 # satu baris systemctl --user restart dua unit
autore logs                    # ikuti log dua unit; Ctrl-C untuk berhenti
autore logs --no-follow        # 50 baris terakhir lalu keluar
autore                         # pilih [4] Admin -> [1] Start -> [5] Kembali
systemctl --user is-active autore-web-api autore-web-dashboard
```

Tidak perlu `systemctl --user restart` apa pun untuk fitur ini: `systemctl` tidak memuat biner `autore`, dan alias/subcommand bekerja langsung dari biner baru.

## Review Focus — yang paling mungkin bos alif ingin ubah

1. **Bentuk keluaran `autore start`.** Yang saya rencanakan: satu baris ringkas aksi + status kedua unit, tanpa ornamen, tanpa banner. Kalau mau lebih ringkas (hanya `[OK]`) atau lebih verbose (tampilkan argv `systemctl`-nya), sebut di review.
2. **`[4]` Admin vs `[4]` Keluar.** Saya mempertahankan `[3] Keluar` supaya label lama dan tes lama tidak bergeser (D3).
3. **`visible_alias` vs `alias`.** Permintaan bos alif menulis `alias` (sembunyi); saya usulkan `visible_alias` supaya alias bisa ditemukan dari `--help` (D8).
4. **`logs` default follow tanpa deteksi TTY** (D7) — ini satu-satunya perilaku di plan ini yang bisa membuat terminal terasa "nyangkut" kalau dipipe.
5. **Cakupan 4 berkas** termasuk `cli/src/launcher.rs` (menambah 2 method trait, `OPSI` 4 entri, teks pesan, panduan non-TTY). Semua perubahan di launcher bersifat tambah; tidak ada perilaku lama yang saya ubah selain teks pesan pilihan yang memang harus ikut jumlah opsi.

## Bukti eksekusi (2026-11-07, VPS, TDD RED -> GREEN)

Keputusan bos alif yang dipakai: (1) menu Admin hanya di menu `autore` sebelum TUI, TUI legacy tidak disentuh; (2) `visible_alias`; (3) sub-menu berputar sampai `Kembali`; (4) penjaga `tugure` berlaku untuk keempat perintah termasuk `logs`; (5) izin 5 berkas DIBERIKAN.

| Task | RED terukur | GREEN |
|---|---|---|
| T1 label + argv | 17 tes gagal `not yet implemented` | 7 lolos |
| T2 penjaga + systemd | sama (badan `jalankan` masih `todo!()`) | 13 lolos |
| T3 logs | sama | 13 lolos |
| T4 tanpa systemd | 5 tes sisa gagal | 18 lolos |
| T5 subcommand + alias + menu | `panicked at src/main.rs:2467: status harus punya alias st` (atribut `visible_alias` dilepas sementara, lalu dipasang balik) | 284 lolos |
| T6 integrasi biner | berkas tes belum ada (tidak ada output tes) | 7 lolos sekali jalan |

```
cargo test --bin autore         -> 284 passed; 0 failed     (sebelum: 263)
cargo test --test admin_cli     -> 7 passed
cargo test --test launcher_cli  -> 5 passed                 (label [3] Keluar tetap, tidak berubah)
cargo test --test scan_cli      -> 3 passed; 2 ignored
cargo test --test sbom_cli      -> 6 passed; 1 FAILED       (cacat lama, di luar lingkup)
cargo build --release --bin autore -> 0 warning
```

Bukti biner nyata (`./target/release/autore`, 0.5.8):

```
autore --help          -> start/stop/restart/logs muncul; [alias: st|dep|qs|doc|in] tampil
autore st --help       -> Usage: autore status [OPTIONS]        exit 0
autore logs --no-follow-> 50 baris journalctl nyata, keluar bersih
autore < /dev/null     -> panduan singkat memuat keempat perintah admin + baris
AUTORE_MENU_PILIHAN=4 AUTORE_ADMIN_PILIHAN=5 autore -> exit 0, tidak menyentuh layanan
systemctl --user is-active autore-web-api autore-web-dashboard -> active / active
systemctl --user show -p NRestarts ...                          -> 0 / 0
```

Non-ASCII pada `--help` hanya baris `about` lama (em dash), tidak ada tambahan baru.

### Penyimpangan kecil dari rencana (disengaja)

1. `Aksi::dari_nama` dihapus: dispatch `main.rs` memakai varian langsung, jadi fungsi itu tak punya pemanggil dan memicu `warning: associated function is never used`. Total tes 285 -> 284.
2. `jalankan_tanpa_systemd(sis, aksi, keluar, web_dir)` menerima `web_dir` sebagai argumen (disuntik) alih-alih membaca `AUTORE_WEB_DIR`; `jalankan` yang mengirim `launcher::cari_web_dir()`. Ini menghindari tes menulis env global.
3. Test teks pesan (`pesan_pilihan_rentang_baru`, `panduan_subcommand_menyebut_admin`) diletakkan di modul tes `launcher.rs`, bukan `main.rs`, karena fungsinya privat di sana.
4. Sub-menu non-TTY tanpa `AUTORE_ADMIN_PILIHAN` mencetak panduan dan keluar dengan kode 0 (tidak ada yang gagal).
5. `const PROSES` dipakai bersama oleh `launcher.rs` dan `admin.rs` supaya nama berkas `api.pid`/`dashboard.pid` hanya ada di satu tempat.

## Pertanyaan yang menunggu keputusan

1. Menu Admin juga ditaruh di **TUI legacy** (`MENU`, 9 entri yang muncul saat `[2] TUI Legacy`), atau cukup di menu `autore` sebelum TUI?
2. Alias: **`visible_alias`** (tampil di `--help`, rekomendasi saya) atau `alias` (sembunyi, persis seperti tulisan bos alif)?
3. Sub-menu Admin: **berputar sampai `Kembali`** (rekomendasi saya) atau langsung keluar ke shell sesudah satu aksi?
4. Penjaga pengguna `tugure`: ikut berlaku untuk `autore logs` (baca saja), atau `logs` dibebaskan untuk semua akun?
5. Izin menyentuh berkas: `cli/src/admin.rs` (baru), `cli/tests/admin_cli.rs` (baru), `cli/src/main.rs`, `cli/src/launcher.rs`, `README.md` — DIBERIKAN?
