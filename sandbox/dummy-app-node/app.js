/** Minimal HTTP app used to exercise the Autore sandbox pipeline. */
"use strict";

const http = require("node:http");

const GREETING = "Hello from Autore sandbox";

/** Isi jawaban mengikuti kontrak dummy app Python: `/` teks, `/health` JSON. */
function kirim(res, status, contentType, body) {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function handler(req, res) {
  if (req.url === "/health") {
    return kirim(res, 200, "application/json", JSON.stringify({ status: "ok" }));
  }
  if (req.url === "/") {
    return kirim(res, 200, "text/plain; charset=utf-8", GREETING);
  }
  return kirim(res, 404, "text/plain; charset=utf-8", "Not Found");
}

function makeServer(port) {
  return http.createServer(handler).listen(port);
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8000);
  makeServer(port);
  console.log(`Listening on 0.0.0.0:${port}`);
}

module.exports = { GREETING, handler, makeServer };
