# Runbook — Watchdog production

Timer systemd memanggil `apps/api/scripts/watchdog.ts` tiap menit untuk satu app.
Script mem-probe `health_check_url` deployment production aktif; setelah
`AUTORE_WATCHDOG_AMBANG` gagal beruntun (default 3) ia memicu rollback ke
deployment sehat terakhir lewat job `<app>-rollback`.

## Mode

- **dry-run** (bawaan script): hanya menulis keputusan ke jurnal, tidak menyentuh
  production.
- **on** (bawaan unit systemd): rollback benar-benar dijalankan.

Mode per app diatur di `/etc/autore/watchdog-<app>.env`.

## Berkas dan env

| Hal | Lokasi |
|---|---|
| Unit | `/etc/systemd/system/autore-watchdog@.service`, `autore-watchdog@.timer` |
| Env global | `/etc/autore/watchdog.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) |
| Env per app | `/etc/autore/watchdog-<app>.env` (opsional, menimpa global) |
| Status | `$AUTORE_WORKSPACE/watchdog-<app>.json` (`gagal_beruntun`) |
| Jurnal | `journalctl -u autore-watchdog@<app>.service` |

Variabel yang dibaca script: `AUTORE_WATCHDOG_APP` (wajib), `AUTORE_WATCHDOG_MODE`,
`AUTORE_WATCHDOG_AMBANG`, `AUTORE_WATCHDOG_TIMEOUT_MS`, `AUTORE_WATCHDOG_URL`
(menimpa URL dari ledger), `AUTORE_NOTIFY_BIN`.

Port host rollback diambil dari `production.deploy_port` di `environments.json`
dan dikirim ke job sebagai `ROLLBACK_DEPLOY_PORT`; tanpa itu container yang sudah
hilang tidak bisa dipulihkan karena port tidak dapat disimpulkan dari container.

## Pasang

```sh
sudo install -m 0644 deploy/systemd/autore-watchdog@.service deploy/systemd/autore-watchdog@.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now autore-watchdog@<app>.timer
```

Unit lama `autore-watchdog.service` (satu app hardcoded) sudah digantikan template
`@`; simpan salinannya di `/etc/autore/units-backup/` sebelum dihapus.

## Uji

```sh
# dry-run dulu kalau app belum siap
echo 'AUTORE_WATCHDOG_MODE=dry-run' | sudo tee /etc/autore/watchdog-<app>.env

# simulasi gangguan
docker stop <app>-production
sudo systemctl start autore-watchdog@<app>.service   # ulangi sampai ambang
journalctl -u autore-watchdog@<app>.service -n 5 -o cat
```

Yang harus terlihat: entri `"aksi":"rollback"` dengan `"ok":true`, job Jenkins
`<app>-rollback` sukses, container hidup lagi, `health=200`, event
`deploy_result` baru `rolled_back` di ledger, dan kabar Telegram.

## Batas

- Satu port per container (aplikasi multiport belum didukung).
- Rollback staging belum mengirim port (entri `staging` di `environments.json`
  tidak dibaca `bacaLingkungan`); rollback staging manual tidak terpengaruh.
- Kalau tidak ada deployment sehat sebelumnya, watchdog hanya mengabari Telegram
  dan keluar 1 — production perlu tindakan manual.
