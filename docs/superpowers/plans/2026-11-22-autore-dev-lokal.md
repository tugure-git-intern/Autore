# Plan: `autore dev` — jalankan project lokal tanpa ribet

Tanggal: 2026-11-22
Status: menunggu persetujuan (belum ada kode)

## Tujuan

Developer sudah punya folder project dan kode, tapi belum punya Dockerfile. Satu perintah:

```
autore dev
```

menghasilkan: Dockerfile (kalau belum ada), image, container jalan, dan satu URL siap dibuka.
Repo GitHub tetap manual (di luar cakupan).

## Cakupan

Termasuk:
- Deteksi stack dari isi folder (`python`, `nodejs`, `java`, `go`), bisa ditimpa `--stack`.
- Tulis hanya `Dockerfile` dan `.dockerignore` yang belum ada, memakai `templates::render_dockerfile`/`render_dockerignore` (satu sumber template, tanpa duplikasi). `Jenkinsfile` tidak dibuat: `connect`/`deploy` yang menambahkannya saat repo didaftarkan ke Jenkins.
- Pilih port host bebas otomatis, atau `--port`. Port aplikasi: `--app-port` atau default stack.
- `docker build` lalu `docker run` di foreground; `Ctrl+C` menghentikan container, `--rm` membersihkannya.
- Nama container `<nama-app>-dev` supaya tidak bertabrakan dengan container staging/production.

Tidak termasuk (sengaja):
- Membuat kode aplikasi/kerangka stack. Kode sudah ada; `init` yang membuat kode contoh.
- Repo GitHub, Jenkins, deploy VPS.
- Rebuild otomatis saat file berubah (`--watch`) — bisa ditambah nanti tanpa mengubah bentuk perintah.
- Entri menu TUI. Ditambahkan terpisah kalau perintahnya sudah dipakai.

## Perilaku

```
autore dev [--app-name <nama>] [--stack python|nodejs|java|go] [--app-port <port>] [--port <port-host>]
```

1. Nama app = `--app-name`, kalau kosong nama folder. Divalidasi `validate_app_name`.
2. Stack = `--stack`, kalau kosong dideteksi `templates::deteksi_stack` (satu implementasi, dipakai juga `connect`). Urutan tetap: `go.mod` → Go, `pom.xml`/`build.gradle(.kts)`/`gradlew` → Java, `package.json` → NodeJs, `requirements.txt`/`pyproject.toml`/`setup.py`/`app.py`/`main.py`/`run.py`/`manage.py` → Python. Tidak ketemu → exit 1:
   `tidak menemukan kode aplikasi di folder ini; sebutkan stack-nya: --stack python|nodejs|java|go`
3. Port app = `--app-port` atau `TechStack::default_port()` (python 8000, nodejs 3000, java/go 8080).
4. Port host = `--port` (ditolak kalau sedang dipakai) atau port bebas pertama dari 8300 ke atas (batas 8400).
5. Berkas pipeline: `Dockerfile` sudah ada → dipakai apa adanya, cetak `pakai Dockerfile yang ada`. Belum ada → generate, cetak tiap berkas yang dibuat.
6. Cetak `➜ http://localhost:<port-host>` **sebelum** container start (URL benar walau app lambat siap).
7. `docker build -t <nama-app>:dev .` — gagal → exit 1 + saran cek Dockerfile.
8. Container lama `<nama-app>-dev` baru dihapus **setelah** build sukses, supaya build gagal tidak mematikan project yang sedang jalan.
9. `docker run --rm --name <nama-app>-dev -p <host>:<app> <nama-app>:dev` di foreground, log ikut tampil.
10. Exit code mengikuti container; Ctrl+C menghentikan container, `--rm` membersihkannya.

## Berkas yang disentuh

- `cli/src/templates.rs` — tambah `pub fn deteksi_stack(dir: &Path) -> Option<TechStack>` (+ tes).
- `cli/src/dev.rs` — modul baru: `DevArgs`, `jalankan(args) -> i32`, pembangun argv `arg_build`/`arg_run`, `cari_port_host`.
- `cli/src/main.rs` — `mod dev;`, varian `Commands::Dev { .. }` dengan doc comment, satu cabang di `execute_command`.
- `cli/src/connect.rs` — `deteksi_stack` lokal dihapus, memakai `templates::deteksi_stack`.
- `cli/tests/dev_cli.rs` — kontrak CLI tanpa Docker (tolak sebelum docker disentuh, `dev` muncul di `--help`).
- `README.md` — satu baris di tabel perintah.

## Tugas (TDD, tiap langkah tes dulu)

1. `templates::deteksi_stack` + tes: tiap penanda menghasilkan stack benar; folder campuran `package.json` + `app.py` → NodeJs (urutan tetap, didokumentasikan); folder kosong → `None`.
2. `dev::cari_port_host` + tes dengan closure palsu: melewati port terpakai, gagal rapi kalau rentang penuh.
3. `dev::arg_build` / `dev::arg_run` + tes bentuk argv persis (kontrak perilaku, bukan baca sumber).
4. `dev::nama_dari_folder` + `--app-name` menang; nama tidak sah ditolak sebelum docker dipanggil.
5. `dev::jalankan` disusun dari fungsi-fungsi di atas; `docker` dipanggil lewat argv array (bukan shell), mengikuti pola `workspace.rs`.
6. `Commands::Dev` di `main.rs` + `--help` deskripsi; cabang dispatch mengembalikan exit code.
7. `README.md` satu baris.

## Verifikasi

```
cd ~/Autore/cli
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --tests -- --test-threads=1
```

Bukti nyata di laptop (manual, dicatat di PR/commit message):

```
mkdir -p ~/tes-autore/hello2 && cd ~/tes-autore/hello2
# app.py stdlib dari tes sebelumnya
autore dev          # harus mencetak URL dan app menjawab
Ctrl+C              # container hilang: docker ps tidak menampilkan hello2-dev
```

## Risiko

- Deteksi stack salah pada folder campuran → ditimpa `--stack`.
- Nama folder mengandung karakter tidak sah → ditolak `validate_app_name`, disarankan `--app-name`.
- Status `unhealthy` (app lambat siap) tidak dianggap gagal: `dev` hanya meneruskan exit code container.
