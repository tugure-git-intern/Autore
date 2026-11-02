#!/usr/bin/env python3
"""Ambil layar TUI Autore lewat PTY lalu render jadi PNG (via Chrome headless).

Skrip bantu untuk verifikasi visual: jalankan TUI di pty berukuran tetap,
kirim tombol skenario, ubah ANSI jadi HTML, lalu screenshot.
"""
import fcntl
import html
import os
import pty
import re
import select
import struct
import subprocess
import sys
import termios
import time

BIN = "/home/mectov/Autore/cli/target/release/autore"
SCRATCH = "/home/mectov/.hermes/cache/scratch"


def ambil(keys: list, cols: int = 100, rows: int = 32, tunggu: float = 1.5) -> str:
    m, s = pty.openpty()
    fcntl.ioctl(s, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    p = subprocess.Popen([BIN], stdin=s, stdout=s, stderr=s, close_fds=True,
                         cwd="/home/mectov/Autore")
    os.close(s)
    buf = b""
    end = time.time() + tunggu
    while time.time() < end:
        r, _, _ = select.select([m], [], [], 0.2)
        if r:
            try:
                buf += os.read(m, 65536)
            except OSError:
                break
    for k in keys:
        os.write(m, k)
        end = time.time() + 0.7
        while time.time() < end:
            r, _, _ = select.select([m], [], [], 0.2)
            if r:
                try:
                    buf += os.read(m, 65536)
                except OSError:
                    break
    os.write(m, b"q")
    time.sleep(0.4)
    try:
        p.wait(timeout=5)
    except Exception:
        p.kill()
    text = buf.decode("utf-8", "replace")
    # Ambil frame terakhir saja: mulai dari MoveTo(0,0) paling akhir.
    tail = text.rsplit("\x1b[1;1H", 1)[-1].lstrip("\x1b[J")
    baris = tail.split("\r\n")
    return "\r\n".join(baris[:rows])


SGR = re.compile(r"\x1b\[([0-9;]*)m")
# Urutan kendali non-warna (masuk alt-screen, pindah kursor, clear) bukan isi layar.
KENDALI = re.compile(r"\x1b\[[0-9;?]*[ABCDEFGHJKSTfhlmsu]")


def bersihkan(layar: str) -> str:
    return KENDALI.sub(lambda m: m.group(0) if m.group(0).endswith("m") else "", layar)


def ke_html(layar: str, judul: str) -> str:
    """Ubah baris ber-ANSI jadi <span> bergaya; hanya SGR yang dipakai TUI."""
    out = []
    for baris in bersihkan(layar).split("\r\n"):
        fg, bg, tebal, redup, balik, pos = None, None, False, False, False, 0
        potong = []
        for m in SGR.finditer(baris):
            potong.append((baris[pos:m.start()], (fg, bg, tebal, redup, balik)))
            kode = [int(x) for x in m.group(1).split(";") if x != ""] or [0]
            i = 0
            while i < len(kode):
                k = kode[i]
                if k == 0:
                    fg, bg, tebal, redup, balik = None, None, False, False, False
                elif k == 1:
                    tebal = True
                elif k == 2:
                    redup = True
                elif k == 7:
                    balik = True
                elif k == 38 and kode[i + 1] == 2:
                    fg = "rgb(%d,%d,%d)" % tuple(kode[i + 2:i + 5])
                    i += 4
                elif k == 48 and kode[i + 1] == 2:
                    bg = "rgb(%d,%d,%d)" % tuple(kode[i + 2:i + 5])
                    i += 4
                elif 30 <= k <= 37:
                    fg = ["#000", "#c33", "#3c3", "#cc3", "#36c", "#c3c", "#3cc", "#ccc"][k - 30]
                elif 90 <= k <= 97:
                    fg = ["#666", "#f66", "#6f6", "#ff6", "#68f", "#f6f", "#6ff", "#fff"][k - 90]
                elif 40 <= k <= 47:
                    bg = ["#000", "#a00", "#0a0", "#aa0", "#00a", "#a0a", "#0aa", "#fff"][k - 40]
                i += 1
            pos = m.end()
        potong.append((baris[pos:], (fg, bg, tebal, redup, balik)))
        for teks, (fg, bg, tebal, redup, balik) in potong:
            teks = html.escape(teks)
            if tebal:
                teks = f"<b>{teks}</b>"
            gaya = []
            if fg:
                gaya.append(f"color:{fg}")
            if bg:
                gaya.append(f"background:{bg}")
            if redup:
                gaya.append("opacity:.6")
            if balik:
                gaya.append("background:#d97757;color:#1b1b1b")
            out.append(f'<span style="{";".join(gaya)}">{teks}</span>' if gaya else teks)
        out.append("\n")
    isi = "".join(out)
    return f"""<!doctype html><meta charset="utf-8"><title>{judul}</title>
<style>
body{{margin:0;background:#161616;font:15px/1.25 "DejaVu Sans Mono",monospace}}
.term{{padding:14px 18px;white-space:pre;color:#e6e6e6}}
</style>
<div class="term">{isi}</div>"""


def screenshot(nama: str, keys: list) -> str:
    layar = ambil(keys)
    html_path = os.path.join(SCRATCH, f"{nama}.html")
    png_path = os.path.join(SCRATCH, f"{nama}.png")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(ke_html(layar, nama))
    subprocess.run([
        "google-chrome", "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2", "--window-size=1180,760",
        f"--screenshot={png_path}", f"file://{html_path}",
    ], check=True, capture_output=True)
    print(png_path)
    return png_path


if __name__ == "__main__":
    screenshot("autore-tui-default", [])
    screenshot("autore-tui-palette", [b"\x0b", b"s", b"c", b"a", b"n"])
    sys.exit(0)
