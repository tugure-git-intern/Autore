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
# distDir sementara milik deploy sendiri, terpisah dari `.next-e2e` milik
# Playwright: kalau keduanya sama, deploy bisa menghapus direktori yang sedang
# dipakai server E2E. `.next-baru` sudah tercantum di `include` tsconfig, jadi
# `next build` tidak menulis ulang tsconfig hanya untuk menambah entri.
BARU="$DASH/.next-baru"
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

# Root tidak boleh: `$HOME` jadi /root, jadi REPO menunjuk pohon yang salah, dan
# artefak `.next` akan dimiliki root sehingga run berikutnya sebagai pemilik gagal.
[ "$(id -u)" -ne 0 ] || bail "jangan jalankan sebagai root; jalankan sebagai pemilik pohon Autore"

# Pemeriksaan murah lebih dulu: lock dibuat dengan `>` yang boleh jadi milik
# pengguna lain, jadi membukanya sebelum cek pemilik menghasilkan "Permission
# denied" mentah alih-alih pesan yang jelas.
[ -d "$DASH" ] || bail "tidak ada $DASH"
[ "$(id -un)" = "$(stat -c %U "$DASH")" ] || bail "jalankan sebagai $(stat -c %U "$DASH"), bukan $(id -un)"
git -C "$REPO" diff --quiet --ignore-submodules || bail "pohon $REPO kotor; commit atau stash dulu"

# Dua run bersamaan saling menimpa distDir sementara: yang satu memindahkannya
# saat yang lain masih menulis. Satu deploy saja pada satu waktu.
exec 9>"$LOCK"
flock -n 9 || bail "deploy lain masih berjalan (lock $LOCK)"

BUILD=
bersih() {
  [ -n "$BUILD" ] && kill -TERM -- "-$BUILD" 2>/dev/null || true
  rm -rf "$BARU"
}
trap bersih EXIT

git -C "$REPO" pull --ff-only --quiet || bail "git pull --ff-only gagal"

versi="$(grep -m1 '^version' "$REPO/cli/Cargo.toml" | cut -d'"' -f2)"
[ "${AUTORE_WEB_BUILD_FORCE_FAIL:-}" = "1" ] && bail "build dipaksa gagal (uji coba)"

rm -rf "$BARU"
# distDir harus diturunkan dari variabel yang sama dengan $BARU, kalau tidak
# build menulis ke satu direktori dan `mv` mencari yang lain.
( cd "$WEB" && exec setsid env AUTORE_NEXT_DIST="$(basename "$BARU")" npm run build:dashboard ) >"$LOG" 2>&1 &
BUILD=$!
wait "$BUILD" || { tail -20 "$LOG" >&2; bail "build gagal; dashboard lama tetap jalan"; }
BUILD=
rm -f "$LOG"
[ -d "$BARU" ] || bail "build selesai tapi $BARU tidak ada; dashboard lama tetap jalan"
# `next build` menulis ulang tsconfig.json (menambah include distDir sementara);
# pohon sudah dijamin bersih di atas, jadi aman dikembalikan.
git -C "$REPO" checkout -- web/apps/dashboard/tsconfig.json 2>/dev/null || true

# Urutan tukar: `.next-lama` kosong dulu (sisa run gagal membuat `mv` menyarangkan
# pohon), lalu `.next` -> `.next-lama`, lalu `.next-baru` -> `.next`. Kalau langkah
# mana pun gagal, `.next` dikembalikan dari `.next-lama` supaya unit tidak pernah
# ditinggal tanpa pohon build.
rm -rf "$LAMA"
if [ -d "$AKTIF" ]; then
  mv "$AKTIF" "$LAMA" || bail "gagal memindahkan $AKTIF ke $LAMA"
fi
if ! mv "$BARU" "$AKTIF"; then
  [ -d "$LAMA" ] && mv "$LAMA" "$AKTIF"
  bail "tukar direktori gagal; dashboard memakai versi lama"
fi

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
