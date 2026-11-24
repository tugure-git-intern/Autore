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

# Alamat dengar diambil dari socket, bukan ditebak: dashboard di-bind ke IP
# tailnet (`next start -H 100.80.3.14`), jadi 127.0.0.1 tidak selalu hidup.
alamat() {
  ss -ltnH "sport = :$PORT" 2>/dev/null | awk '{print $4}' | sed 's/:[^:]*$//' | head -1
}

# Proses menjawab = kode HTTP apa pun selain 000 (307 ke /login itu normal).
hidup() {
  local host
  host="$(alamat)"
  [ -n "$host" ] || return 1
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$host:$PORT/login" || true)" != "000" ]
}

[ -d "$DASH" ] || bail "tidak ada $DASH"
[ "$(id -un)" = "$(stat -c %U "$DASH")" ] || bail "jalankan sebagai $(stat -c %U "$DASH"), bukan $(id -un)"
git -C "$REPO" diff --quiet --ignore-submodules || bail "pohon $REPO kotor; commit atau stash dulu"
git -C "$REPO" pull --ff-only --quiet || bail "git pull --ff-only gagal"

versi="$(grep -m1 '^version' "$REPO/cli/Cargo.toml" | cut -d'"' -f2)"
[ "${AUTORE_WEB_BUILD_FORCE_FAIL:-}" = "1" ] && bail "build dipaksa gagal (uji coba)"

rm -rf "$BARU"
( cd "$WEB" && AUTORE_NEXT_DIST=.next-baru npm run build:dashboard ) || bail "build gagal; dashboard lama tetap jalan"
# `next build` menulis ulang tsconfig.json (menambah include distDir sementara);
# pohon sudah dijamin bersih di atas, jadi aman dikembalikan.
git -C "$REPO" checkout -- web/apps/dashboard/tsconfig.json 2>/dev/null || true

[ -d "$AKTIF" ] && mv "$AKTIF" "$LAMA" || true
mv "$BARU" "$AKTIF" || bail "tukar direktori gagal"

systemctl --user restart "$UNIT"
for _ in $(seq 20); do
  if hidup; then
    rm -rf "$LAMA"
    echo "dashboard v$versi aktif di $(alamat):$PORT"
    exit 0
  fi
  sleep 1
done

echo "dashboard tidak sehat setelah build baru; balik ke versi lama" >&2
rm -rf "$AKTIF"
[ -d "$LAMA" ] && mv "$LAMA" "$AKTIF"
systemctl --user restart "$UNIT"
exit 1
