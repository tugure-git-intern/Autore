#!/usr/bin/env python3
"""Backup ledger Autore dan rotasi log harian.

Ledger `release-state.json` adalah satu-satunya riwayat rilis, jadi salinannya disimpan
harian di `<workspace>/backup/` dan dipangkas ke 30 hari terakhir. `image-retention.log`
digzip begitu lewat 1 MB supaya tidak tumbuh tanpa batas. Skrip ini tidak pernah menulis
ke ledger: hanya membaca, memvalidasi, lalu menyalin. Default dry-run, `--apply` untuk
benar-benar menulis.
"""
import gzip
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

WS = Path(os.environ.get("AUTORE_WORKSPACE", str(Path.home() / "autore-workspace")))
LEDGER = Path(os.environ.get("AUTORE_LEDGER", str(WS / "release-state.json")))
BACKUP = Path(os.environ.get("AUTORE_BACKUP_DIR", str(WS / "backup")))
LOG = Path(os.environ.get("AUTORE_RETENTION_LOG", str(WS / "image-retention.log")))
SIMPAN_HARI = int(os.environ.get("AUTORE_BACKUP_DAYS", "30"))
LOG_MAKS = int(os.environ.get("AUTORE_LOG_MAX_BYTES", str(1024 * 1024)))
LOG_SIMPAN_HARI = int(os.environ.get("AUTORE_LOG_KEEP_DAYS", "90"))


def ledger_sah(path):
    """Ledger hanya layak disalin kalau JSON-nya sah dan punya larik `events`."""
    try:
        isi = json.loads(path.read_text())
    except (OSError, ValueError):
        return False
    return isinstance(isi, dict) and isinstance(isi.get("events"), list)


def salin_ledger(ledger, backup_dir, hari):
    """Salin ledger ke `backup/release-state-YYYYMMDD.json`; None kalau ledger tidak sah."""
    if not ledger_sah(ledger):
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    tujuan = backup_dir / f"release-state-{hari:%Y%m%d}.json"
    shutil.copy2(ledger, tujuan)
    return tujuan


def pangkas_backup(backup_dir, hari, simpan_hari=SIMPAN_HARI):
    """Hapus backup yang tanggalnya di namanya lebih tua dari `simpan_hari`."""
    batas = hari - timedelta(days=simpan_hari)
    dihapus = []
    for berkas in sorted(backup_dir.glob("release-state-*.json")):
        try:
            tanggal = datetime.strptime(berkas.stem.removeprefix("release-state-"), "%Y%m%d")
        except ValueError:
            continue
        if tanggal < batas:
            berkas.unlink()
            dihapus.append(berkas.name)
    return dihapus


def rotasi_log(log, hari, maks=LOG_MAKS):
    """Gzip log kalau lewat `maks`, lalu kosongkan log hidup. None kalau belum perlu."""
    if not log.exists() or log.stat().st_size <= maks:
        return None
    tujuan = log.with_name(f"{log.stem}-{hari:%Y%m%d}.log.gz")
    with log.open("rb") as asal, gzip.open(tujuan, "wb") as keluar:
        shutil.copyfileobj(asal, keluar)
    log.write_bytes(b"")
    return tujuan


def pangkas_rotasi(log, hari, simpan_hari=LOG_SIMPAN_HARI):
    """Hapus gz rotasi yang lebih tua dari `simpan_hari`."""
    batas = hari - timedelta(days=simpan_hari)
    dihapus = []
    for berkas in sorted(log.parent.glob(f"{log.stem}-*.log.gz")):
        try:
            tanggal = datetime.strptime(berkas.name.removeprefix(f"{log.stem}-")[:8], "%Y%m%d")
        except ValueError:
            continue
        if tanggal < batas:
            berkas.unlink()
            dihapus.append(berkas.name)
    return dihapus


def main():
    apply = "--apply" in sys.argv
    hari = datetime.now()
    baris = [f"{hari.isoformat(timespec='seconds')} mode={'apply' if apply else 'dry-run'}"]

    if not ledger_sah(LEDGER):
        print("\n".join(baris + [f"  ledger tidak ada atau tidak sah: {LEDGER}"]))
        return 1

    tujuan = BACKUP / f"release-state-{hari:%Y%m%d}.json"
    baris.append(f"  {'salin' if apply else 'akan salin'} {LEDGER} -> {tujuan}")

    if not apply:
        if LOG.exists() and LOG.stat().st_size > LOG_MAKS:
            baris.append(f"  akan rotasi {LOG} ({LOG.stat().st_size} byte > {LOG_MAKS})")
        print("\n".join(baris))
        return 0

    hasil = salin_ledger(LEDGER, BACKUP, hari)
    baris.append(f"  salin {'ok' if hasil else 'gagal'}")
    dipangkas = pangkas_backup(BACKUP, hari)
    baris.append(f"  pangkas backup: {len(dipangkas)} berkas")
    rotasi = rotasi_log(LOG, hari)
    baris.append(f"  rotasi log: {rotasi.name if rotasi else 'tidak perlu'}")
    baris.append(f"  pangkas rotasi: {len(pangkas_rotasi(LOG, hari))} berkas")
    print("\n".join(baris))
    return 0 if hasil else 1


def self_test():
    import hashlib

    with tempfile.TemporaryDirectory(prefix="autore-backup-tes-") as tmp:
        akar = Path(tmp)
        ledger = akar / "release-state.json"
        isi = json.dumps({"events": [{"kind": "approved", "app": "a", "build_number": 1}]})
        ledger.write_text(isi)
        sidik = hashlib.sha256(ledger.read_bytes()).hexdigest()
        hari = datetime(2026, 11, 15)

        # Ledger rusak tidak boleh menghasilkan backup kosong yang menipu.
        rusak = akar / "rusak.json"
        rusak.write_text("{bukan json")
        assert not ledger_sah(rusak)
        assert salin_ledger(rusak, akar / "backup", hari) is None
        assert not (akar / "backup").exists()

        tujuan = salin_ledger(ledger, akar / "backup", hari)
        assert tujuan == akar / "backup" / "release-state-20261115.json"
        assert tujuan.read_text() == isi
        assert hashlib.sha256(ledger.read_bytes()).hexdigest() == sidik

        # 30 hari: 2026-10-15 lulus, 2026-10-16 masih disimpan, nama asing diabaikan.
        for nama, tanggal in [
            ("release-state-20261015.json", datetime(2026, 10, 15)),
            ("release-state-20261016.json", datetime(2026, 10, 16)),
            ("catatan-lain.json", None),
        ]:
            berkas = akar / "backup" / nama
            berkas.write_text("{}" if tanggal else "abaikan")
        assert pangkas_backup(akar / "backup", hari) == ["release-state-20261015.json"]
        assert (akar / "backup" / "release-state-20261016.json").exists()
        assert (akar / "backup" / "catatan-lain.json").exists()

        # Rotasi: log 2 MB jadi gz dengan isi utuh, log hidup kosong, gz lama dipangkas.
        log = akar / "image-retention.log"
        log.write_bytes(b"baris\n" * 400_000)
        assert log.stat().st_size > LOG_MAKS
        gz = rotasi_log(log, hari)
        assert gz == akar / "image-retention-20261115.log.gz"
        assert log.stat().st_size == 0
        with gzip.open(gz, "rb") as berkas:
            assert berkas.read() == b"baris\n" * 400_000
        lama = akar / "image-retention-20260601.log.gz"
        lama.write_bytes(b"")
        assert pangkas_rotasi(log, hari) == ["image-retention-20260601.log.gz"]
        assert not lama.exists() and gz.exists()

        # Log kecil tidak dirotasi.
        log.write_bytes(b"kecil\n")
        assert rotasi_log(log, hari) is None

    print("self-test ok")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        sys.exit(main())