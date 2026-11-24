#!/usr/bin/env bash
# Bangun ulang dashboard supaya nomor versi di sidebar ikut `cli/Cargo.toml`.
# Jalankan sebagai pemilik pohon Autore (bukan root, bukan jenkins).
# Build ke `.next-e2e`, tukar, restart; kalau tak sehat balik ke `.next-lama`.
set -euo pipefail

REPO="${AUTORE_REPO:-$HOME/Autore}"
WEB="$REPO/web"
DASH="$WEB/apps/dashboard"
UNIT="${AUTORE_WEB_UNIT:-autore-web-dashboard}"
PORT="${AUTORE_WEB_PORT:-9120}"
AKTIF="$DASH/.next"
# distDir sementara memakai nama yang sudah tercantum di `tsconfig.json`
# (`.next-e2e`), supaya `next build` tidak menulis ulang tsconfig hanya untuk
# menambah `include` baru.
BARU="$DASH/.next-e2e"
LAMA="$DASH/.next-lama"
LOG="${TMPDIR:-/tmp}/autore-deploy-web.log"
LOCK="${AUTORE_WEB_LOCK:-/tmp/autore-deploy-web.lock}"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

bail() { echo "GAGAL: $*" >&2; exit 1; }
pakai() { sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  "") ;;
  -h|--help) pakai; exit 0 ;;
  *) bail "skrip ini tidak menerima argumen; lihat --help" ;;
esac

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

# Dua run bersamaan saling menimpa `.next-baru`: yang satu memindahkannya saat
# yang lain masih menulis. Satu deploy saja pada satu waktu.
exec 9>"$LOCK"
flock -n 9 || bail "deploy lain masih berjalan (lock $LOCK)"

BUILD=
bersih() {
  [ -n "$BUILD" ] && kill -TERM -- "-$BUILD" 2>/dev/null || true
  rm -rf "$BARU"
}
trap bersih EXIT

[ -d "$DASH" ] || bail "tidak ada $DASH"
[ "$(id -un)" = "$(stat -c %U "$DASH")" ] || bail "jalankan sebagai $(stat -c %U "$DASH"), bukan $(id -un)"
git -C "$REPO" diff --quiet --ignore-submodules || bail "pohon $REPO kotor; commit atau stash dulu"
git -C "$REPO" pull --ff-only --quiet || bail "git pull --ff-only gagal"

versi="$(grep -m1 '^version' "$REPO/cli/Cargo.toml" | cut -d'"' -f2)"
[ "${AUTORE_WEB_BUILD_FORCE_FAIL:-}" = "1" ] && bail "build dipaksa gagal (uji coba)"

rm -rf "$BARU"
( cd "$WEB" && exec setsid env AUTORE_NEXT_DIST=.next-e2e npm run build:dashboard ) >"$LOG" 2>&1 &
BUILD=$!
wait "$BUILD" || { tail -20 "$LOG" >&2; bail "build gagal; dashboard lama tetap jalan"; }
BUILD=
rm -f "$LOG"
# `next build` menulis ulang tsconfig.json (menambah include distDir sementara);
# pohon sudah dijamin bersih di atas, jadi aman dikembalikan.
git -C "$REPO" checkout -- web/apps/dashboard/tsconfig.json 2>/dev/null || true

# Sisa `.next-lama` dari run yang pernah gagal harus dibuang dulu: `mv .next
# .next-lama` saat target sudah ada akan menyarangkan pohon, bukan menukarnya.
rm -rf "$LAMA"
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
if [ -d "$LAMA" ]; then
  rm -rf "$AKTIF"
  mv "$LAMA" "$AKTIF"
  systemctl --user restart "$UNIT"
  hidup && echo "sudah balik, dashboard memakai versi lama" >&2
else
  echo "tidak ada .next-lama untuk dibalik; dashboard mungkin tetap tidak sehat" >&2
fi
exit 1
