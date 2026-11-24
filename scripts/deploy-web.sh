#!/usr/bin/env bash
# Bangun ulang dashboard supaya nomor versi di sidebar ikut `cli/Cargo.toml`.
# Jalankan sebagai pemilik pohon Autore (bukan root, bukan jenkins).
# Build ke `.next-baru`, tukar, restart; kalau sehat gagal, balik ke `.next-lama`.
set -euo pipefail

REPO="${AUTORE_REPO:-$HOME/Autore}"
WEB="$REPO/web"
DASH="$WEB/apps/dashboard"
UNIT="${AUTORE_WEB_UNIT:-autore-web-dashboard}"
PORT="${AUTORE_WEB_PORT:-9120}"
AKTIF="$DASH/.next"
BARU="$DASH/.next-baru"
LAMA="$DASH/.next-lama"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

bail() { echo "GAGAL: $*" >&2; exit 1; }
hidup() {
  local kode
  kode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/login" || true)"
  [[ "$kode" == "200" || "$kode" == "307" ]]
}

[ -d "$DASH" ] || bail "tidak ada $DASH"
[ "$(id -un)" = "$(stat -c %U "$DASH")" ] || bail "jalankan sebagai $(stat -c %U "$DASH"), bukan $(id -un)"
git -C "$REPO" diff --quiet --ignore-submodules || bail "pohon $REPO kotor; commit atau stash dulu"
git -C "$REPO" pull --ff-only --quiet || bail "git pull --ff-only gagal"

versi="$(grep -m1 '^version' "$REPO/cli/Cargo.toml" | cut -d'"' -f2)"
sekarang="$(grep -rho 'v[0-9]\+\.[0-9]\+\.[0-9]\+' "$AKTIF/static/chunks" 2>/dev/null | sort -u | tr '\n' ' ')"
if [ "$sekarang" = "v$versi " ] && [ -z "${AUTORE_WEB_FORCE:-}" ]; then
  echo "dashboard sudah v$versi, tak perlu build"
  exit 0
fi

rm -rf "$BARU"
( cd "$WEB" && AUTORE_NEXT_DIST=.next-baru npm run build:dashboard ) || bail "build gagal; dashboard lama tetap jalan"

[ -d "$AKTIF" ] && mv "$AKTIF" "$LAMA" || true
mv "$BARU" "$AKTIF" || bail "tukar direktori gagal"

systemctl --user restart "$UNIT"
for _ in $(seq 10); do
  if hidup; then
    rm -rf "$LAMA"
    echo "dashboard v$versi aktif"
    exit 0
  fi
  sleep 1
done

echo "dashboard tidak sehat setelah build baru; balik ke versi lama" >&2
rm -rf "$AKTIF"
[ -d "$LAMA" ] && mv "$LAMA" "$AKTIF"
systemctl --user restart "$UNIT"
exit 1
