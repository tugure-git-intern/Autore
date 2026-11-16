#!/usr/bin/env python3
"""Retensi image Docker lokal Autore: simpan 10 build terakhir per app.

Hanya menyentuh Docker lokal. Nexus, ledger, dan log Jenkins tidak disentuh,
jadi jejak audit dan rollback by digest tetap utuh. Image yang sedang dipakai
container atau masih dirujuk rilis berjalan tidak pernah dihapus.
"""
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

PREFIX = "127.0.0.1:5000/"
TAG_RE = re.compile(r"^build-(\d+)-commit-")
KEEP = int(os.environ.get("AUTORE_KEEP_BUILDS", "10"))
LEDGER = Path(os.environ.get("AUTORE_LEDGER", str(Path.home() / "autore-workspace/release-state.json")))
LOG = Path(os.environ.get("AUTORE_RETENTION_LOG", str(Path.home() / "autore-workspace/image-retention.log")))
DIRUJUK = ("approved", "rejected")


def build_dirujuk(events):
    """Build yang tidak boleh dihapus meski sudah lewat 10 terakhir."""
    dilindungi = set()
    terakhir = {}
    for e in events:
        app, nomor = e.get("app"), e.get("build_number")
        if not app or nomor is None:
            continue
        if e.get("kind") in DIRUJUK:
            dilindungi.add((app, nomor))
        if e.get("kind") == "deploy_result" and e.get("outcome") == "success":
            if e.get("environment") in ("staging", "production"):
                terakhir[(app, e["environment"])] = nomor
    dilindungi.update((app, nomor) for (app, _), nomor in terakhir.items())
    return dilindungi


def pilih_hapus(images, dilindungi, keep=KEEP):
    """images: iterable (repo, tag, image_id). Hasil: [(repo, tag)] siap dihapus."""
    per_app = defaultdict(list)
    for repo, tag, _ in images:
        m = TAG_RE.match(tag)
        if m and repo.startswith(PREFIX):
            per_app[repo].append((int(m.group(1)), tag))
    hapus = []
    for repo, builds in per_app.items():
        app = repo[len(PREFIX):]
        builds.sort(reverse=True)
        for nomor, tag in builds[keep:]:
            if (app, nomor) not in dilindungi:
                hapus.append((repo, tag))
    return hapus


def daftar_image():
    out = subprocess.run(
        ["docker", "images", "--format", "{{.Repository}}\t{{.Tag}}\t{{.ID}}"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [tuple(line.split("\t")) for line in out.splitlines() if line.count("\t") == 2]


def dipakai_container(repo, tag):
    """Image yang masih dirujuk container (termasuk yang berhenti) jangan di-rmi."""
    hasil = subprocess.run(
        ["docker", "ps", "-a", "--filter", f"ancestor={repo}:{tag}", "--format", "{{.ID}}"],
        capture_output=True, text=True,
    )
    return hasil.stdout.strip() != ""


def galat_dipakai(stderr):
    return "image is being used" in stderr or "must be forced" in stderr


def main():
    apply = "--apply" in sys.argv
    events = []
    if LEDGER.exists():
        events = json.loads(LEDGER.read_text()).get("events", [])
    dilindungi = build_dirujuk(events)
    kandidat = pilih_hapus(daftar_image(), dilindungi)

    baris = [f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} mode={'apply' if apply else 'dry-run'} kandidat={len(kandidat)}"]
    gagal = 0
    ditahan = 0
    for repo, tag in kandidat:
        if not apply:
            baris.append(f"  akan hapus {repo}:{tag}")
            continue
        # Container berhenti pun masih memakai image; itu bukan kegagalan retensi.
        if dipakai_container(repo, tag):
            ditahan += 1
            baris.append(f"  tahan {repo}:{tag} (dipakai container)")
            continue
        hasil = subprocess.run(["docker", "rmi", f"{repo}:{tag}"], capture_output=True, text=True)
        if hasil.returncode == 0:
            baris.append(f"  hapus {repo}:{tag}")
        elif galat_dipakai(hasil.stderr):
            ditahan += 1
            baris.append(f"  tahan {repo}:{tag} (dipakai container)")
        else:
            gagal += 1
            baris.append(f"  lewati {repo}:{tag} ({hasil.stderr.strip().splitlines()[-1:]})")
    if apply:
        prune = subprocess.run(["docker", "image", "prune", "-f"], capture_output=True, text=True)
        terakhir = [b for b in prune.stdout.splitlines() if "Total reclaimed" in b]
        baris.append(f"  prune dangling: {terakhir[0] if terakhir else 'n/a'}")
    baris.append(f"selesai kandidat={len(kandidat)} ditahan={ditahan} gagal={gagal}")

    teks = "\n".join(baris)
    print(teks)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(teks + "\n")
    return 1 if gagal else 0


def self_test():
    app = PREFIX + "app"
    images = [(app, f"build-{n}-commit-x", f"id{n}") for n in range(1, 13)]
    images.append(("lain/app", "build-99-commit-x", "lain"))
    assert pilih_hapus(images, {("app", 2)}) == [(app, "build-1-commit-x")]
    assert pilih_hapus(images, set(), keep=12) == []
    assert build_dirujuk([
        {"kind": "deploy_result", "app": "a", "build_number": 7, "environment": "staging", "outcome": "success"},
        {"kind": "deploy_result", "app": "a", "build_number": 8, "environment": "staging", "outcome": "success"},
        {"kind": "approved", "app": "a", "build_number": 3, "environment": "staging"},
    ]) == {("a", 8), ("a", 3)}
    assert galat_dipakai("Error response from daemon: conflict: unable to delete abc (must be forced) - image is being used by stopped container def")
    assert not galat_dipakai("permission denied while trying to connect to the Docker daemon socket")
    print("self-test ok")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        sys.exit(main())
