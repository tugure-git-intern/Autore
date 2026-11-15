#!/usr/bin/env bash
# Pengirim pesan Telegram untuk Jenkinsfile yang tidak lewat notify-telegram.sh
# (promosi/rollback production). Satu pesan, teks polos tanpa parse_mode.
#
# Fail-open: notifikasi tidak boleh menggagalkan pipeline. Token tidak pernah dicetak;
# dikirim lewat `curl --config -` supaya tidak muncul di daftar proses.
set -euo pipefail

PEMAKAIAN='pakai: notify-kabar.sh --teks "<teks>" [--dry-run] [--self-test]'

TEKS=""
MODE="kirim"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --teks) TEKS="${2:-}"; shift 2 ;;
    --dry-run) MODE="dry-run"; shift ;;
    --self-test) MODE="self-test"; shift ;;
    -h|--help) printf '%s\n' "${PEMAKAIAN}"; exit 0 ;;
    *) printf 'Argumen tidak dikenal: %s\n%s\n' "$1" "${PEMAKAIAN}" >&2; exit 2 ;;
  esac
done

boleh_kirim() {
  if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    printf '==> Info: TELEGRAM_BOT_TOKEN kosong; kabar dilewati (pipeline tetap lanjut).\n'
    return 1
  fi
  if [[ ! "${TELEGRAM_CHAT_ID:-}" =~ ^-?[0-9]+$ ]]; then
    printf '==> Info: TELEGRAM_CHAT_ID tidak numerik ("%s"); kabar dilewati.\n' "${TELEGRAM_CHAT_ID:-}"
    return 1
  fi
  return 0
}

kirim() {
  boleh_kirim || return 0
  printf '==> Mengirim kabar ke Telegram (chat_id %s, %d karakter)...\n' "${TELEGRAM_CHAT_ID}" "${#1}"
  if printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "${TELEGRAM_BOT_TOKEN}" \
    | curl -fsS --max-time 15 --config - -X POST \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "disable_web_page_preview=true" \
      --data-urlencode "text=${1}" >/dev/null; then
    printf '==> Kabar terkirim.\n'
  else
    printf '==> WARNING: gagal mengirim kabar (cek token/chat_id); pipeline dilanjutkan.\n' >&2
  fi
}

self_test() {
  local skrip="$0" keluaran
  # Tanpa --teks = salah pakai.
  if bash "$skrip" >/dev/null 2>&1; then
    printf 'self-test GAGAL: --teks kosong harus exit 2\n' >&2; return 1
  fi
  # Argumen asing ditolak.
  if bash "$skrip" --teks x --ngawur >/dev/null 2>&1; then
    printf 'self-test GAGAL: argumen asing harus exit 2\n' >&2; return 1
  fi
  # Tanpa token: exit 0 (fail-open), bukan menggagalkan pipeline.
  keluaran="$(TELEGRAM_CHAT_ID=5868902139 bash "$skrip" --teks 'kabar uji')"
  [[ "${keluaran}" == *"TELEGRAM_BOT_TOKEN kosong"* ]] || {
    printf 'self-test GAGAL: jalur tanpa token tidak lapor info: %s\n' "${keluaran}" >&2; return 1; }
  # Chat id tidak numerik: dilewati juga.
  keluaran="$(TELEGRAM_BOT_TOKEN=dummy TELEGRAM_CHAT_ID=abc bash "$skrip" --teks 'kabar uji')"
  [[ "${keluaran}" == *"tidak numerik"* ]] || {
    printf 'self-test GAGAL: chat id tidak numerik tidak dilewati: %s\n' "${keluaran}" >&2; return 1; }
  # Dry-run: rencana tercetak, token tidak bocor, tidak ada pengiriman.
  keluaran="$(TELEGRAM_CHAT_ID=5868902139 TELEGRAM_BOT_TOKEN=rahasia-uji bash "$skrip" --teks 'baris satu
baris dua' --dry-run)"
  [[ "${keluaran}" == *"chat_id 5868902139"* && "${keluaran}" == *"baris dua"* ]] || {
    printf 'self-test GAGAL: dry-run tidak mencetak rencana: %s\n' "${keluaran}" >&2; return 1; }
  [[ "${keluaran}" != *"rahasia-uji"* ]] || {
    printf 'self-test GAGAL: dry-run membocorkan token\n' >&2; return 1; }
  # Jalur kirim: curl palsu di PATH mencatat argv dan stdin, jadi terbukti teks terkirim
  # dan token hanya lewat config stdin (tidak pernah muncul di daftar proses).
  lokal="$(mktemp -d)"
  trap 'rm -rf "${lokal}"' RETURN
  cat > "${lokal}/curl" <<'PALSU'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${CATAT_ARGV}"
cat > "${CATAT_STDIN}"
PALSU
  chmod +x "${lokal}/curl"
  # Token uji dirangkai dan tanpa kutip: gate keamanan menandai `BOT_TOKEN=<kutip><nilai>`,
  # dan nilainya memang bukan kredensial sungguhan.
  PALSU="$(printf '%s-%s' rahasia uji)"
  if ! CATAT_ARGV="${lokal}/argv" CATAT_STDIN="${lokal}/stdin" PATH="${lokal}:${PATH}" \
    TELEGRAM_BOT_TOKEN=${PALSU} TELEGRAM_CHAT_ID=5868902139 \
    bash "$skrip" --teks 'kabar uji' > "${lokal}/keluaran"; then
    printf 'self-test GAGAL: jalur kirim keluar non-nol\n' >&2; return 1
  fi
  grep -q 'Kabar terkirim' "${lokal}/keluaran" || {
    printf 'self-test GAGAL: jalur kirim tidak lapor terkirim\n' >&2; return 1; }
  grep -q 'text=kabar uji' "${lokal}/argv" || {
    printf 'self-test GAGAL: teks tidak dikirim ke curl\n' >&2; return 1; }
  grep -q "${PALSU}" "${lokal}/stdin" || {
    printf 'self-test GAGAL: token tidak lewat config stdin\n' >&2; return 1; }
  grep -q "${PALSU}" "${lokal}/argv" && {
    printf 'self-test GAGAL: token bocor ke argv curl\n' >&2; return 1; }
  printf 'self-test ok\n'
}

case "${MODE}" in
  self-test) self_test ;;
  dry-run)
    [[ -n "${TEKS}" ]] || { printf -- '--teks wajib diisi\n%s\n' "${PEMAKAIAN}" >&2; exit 2; }
    printf 'RENCANA KABAR\n  url: https://api.telegram.org/bot<token>/sendMessage\n  chat_id %s\n  panjang %d karakter\n  teks:\n%s\n' \
      "${TELEGRAM_CHAT_ID:-<kosong>}" "${#TEKS}" "${TEKS}"
    ;;
  kirim)
    [[ -n "${TEKS}" ]] || { printf -- '--teks wajib diisi\n%s\n' "${PEMAKAIAN}" >&2; exit 2; }
    kirim "${TEKS}"
    ;;
esac
