# TUI layar penuh di Windows

Sejak `feat(cli): TUI layar penuh jalan juga di Windows`, CLI Autore memakai **satu jalur
kode** untuk Linux/macOS dan Windows. Dulu Windows jatuh ke menu teks karena penangkap
output memakai `fd` POSIX.

## Tiga titik yang berbeda per OS

| Kebutuhan | POSIX (`src/tui.rs`) | Windows (`src/tui/tui_win.rs`) |
|---|---|---|
| Sink layar | `/dev/tty` | `CONOUT$` + `ENABLE_VIRTUAL_TERMINAL_PROCESSING` + `SetConsoleOutputCP(65001)` |
| Ukuran layar | `crossterm::terminal::size()` | `GetConsoleScreenBufferInfo` pada handle `CONOUT$` |
| Tangkap stdout+stderr | `pipe` + `dup2` | `CreatePipe` + `SetStdHandle` |

Sisanya (menu, panel log, kotak pertanyaan, status bar, `salurkan`, `buang_kendali`)
dipakai bersama. Tidak ada dependensi baru: sembilan fungsi `kernel32` dideklarasikan
langsung di `tui_win.rs`, pola yang sama dengan `extern "C"` di `tui.rs`.

Dua aturan yang menjaga ini tetap benar:

1. **Cek terminal sebelum stdout dipakai.** Windows meng-cache handle stdout Rust, jadi
   `Tangkap` (yang memanggil `SetStdHandle`) hanya berpengaruh kalau belum ada yang
   menulis. Karena itu `main.rs` memakai `tui::stdout_terminal()` (GetConsoleMode mentah),
   bukan `std::io::stdout().is_terminal()`.
2. **Ukuran layar dibaca dari handle `CONOUT$`,** bukan dari `terminal::size()`: setelah
   stdout dialihkan ke pipe, handle stdout bukan console lagi.

Menu teks tetap dipakai kalau stdout bukan terminal (dipipe ke `grep`, CI) atau kalau
console menolak mode VT (Windows sangat lama).

## Build

Cross-compile dari Linux (yang dipakai untuk rilis):

```bash
rustup target add x86_64-pc-windows-gnu
sudo apt-get install -y mingw-w64
cargo build --release --target x86_64-pc-windows-gnu --manifest-path cli/Cargo.toml
# hasil: cli/target/x86_64-pc-windows-gnu/release/autore.exe (PE32+ x86-64, ~7 MB)
```

Build langsung di Windows juga sama seperti biasa: `cargo build --release --manifest-path cli/Cargo.toml`.

## Checklist uji manual (harus di mesin Windows)

Belum dijalankan — tidak ada mesin Windows saat perubahan ini dibuat. Jalankan dari
**Windows Terminal atau PowerShell baru**, bukan `cmd.exe` lama:

- [ ] `autore.exe` tanpa argumen menampilkan TUI layar penuh (bukan daftar bernomor).
- [ ] Panah atas/bawah memindah sorotan; Enter menjalankan item.
- [ ] Banner memakai blok penuh dan `✔ ✘ ↑ ↓` tampil benar (bukan `?` atau mojibake) —
      ini yang dijaga `SetConsoleOutputCP(65001)`.
- [ ] Panel kanan menerima keluaran job: jalankan `autore env list`, output masuk panel
      dan layar tidak berantakan.
- [ ] `autore deploy` (atau job lain yang memanggil `docker`/`git`) — keluaran anak proses
      ikut masuk panel, bukan menimpa layar.
- [ ] Pertanyaan interaktif (`autore connect`, nama project) muncul sebagai kotak di layar,
      bukan prompt di luar TUI; `Esc` membatalkan dengan rapi.
- [ ] Keluar dari menu mengembalikan layar normal, kursor terlihat, dan tidak ada sisa
      warna/huruf.
- [ ] `autore.exe | more` (stdout dipipe) **tidak** masuk TUI — tetap daftar teks.
- [ ] `autore.exe > out.txt` selesai dan `out.txt` berisi keluaran normal.
- [ ] Ukuran jendela: perkecil jendela lalu buka menu baru — layout tetap dalam batas
      (fallback 80x24 kalau console menolak).

## Batasan yang diketahui

- `cargo test` lintas-target (`--all-targets --target x86_64-pc-windows-gnu`) masih gagal
  di modul lain (`external.rs`, `hooks.rs`, `scanner.rs`) karena kode **test** memakai
  `PermissionsExt::from_mode`/`.mode()` tanpa gerbang `cfg(unix)`. Ini bukan bagian TUI:
  binary Windows-nya sendiri bersih (0 error, 0 warning). Perbaikan terpisah kalau
  Windows mau ikut CI.
- Tidak ada penyesuaian ukuran jendela saat berjalan (belum pernah ada, di POSIX juga);
  ukuran dibaca ulang setiap kali layar digambar, jadi menu berikutnya sudah mengikuti.
