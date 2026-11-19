"""Minimal HTTP app used to exercise the Autore sandbox pipeline."""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

GREETING = "Hello from Autore sandbox"


def sapaan() -> str:
    """GREETING plus APP_VERSION, supaya staging vs production bisa dibedakan
    saat demo promote/rollback tanpa membuka docker inspect."""
    versi = os.environ.get("APP_VERSION", "").strip()
    return f"{GREETING} ({versi})" if versi else GREETING


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._send(200, "application/json", json.dumps({"status": "ok"}))
        elif self.path == "/":
            self._send(200, "text/plain; charset=utf-8", sapaan())
        else:
            self._send(404, "text/plain; charset=utf-8", "Not Found")

    def _send(self, status, content_type, body):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def make_server(host: str, port: int) -> HTTPServer:
    return HTTPServer((host, port), Handler)


if __name__ == "__main__":
    server = make_server("0.0.0.0", 8000)
    print("Listening on 0.0.0.0:8000", flush=True)
    server.serve_forever()
