import { NextRequest } from "next/server";

/**
 * Mengembalikan permintaan dengan origin sesuai host yang benar-benar dibuka
 * browser.
 *
 * Di belakang `next start`, `request.url` berisi alamat bind server
 * (`http://localhost:9120/...`). Auth.js memakai origin itu untuk menyusun
 * `callbackUrl` provider (`@auth/core/lib/index.js` → `url: request.url`, lalu
 * `lib/utils/providers.js:8` → `new URL(basePath, params.url.origin)`).
 * Akibatnya `redirect_uri` yang dikirim ke GitHub berisi `localhost` dan
 * ditolak sebagai `redirect_uri_mismatch` — login tidak pernah sampai callback.
 *
 * Karena itu origin diganti dari `x-forwarded-host`/`x-forwarded-proto` (Next
 * mengisi keduanya dari header `Host`). Hanya origin yang berubah: metode,
 * header, dan badan permintaan dibawa apa adanya, jadi POST signin/callback
 * tetap utuh.
 */
export function denganHostAsli(req: NextRequest): NextRequest {
  const host = (req.headers.get("host") ?? req.headers.get("x-forwarded-host"))
    ?.split(",")[0]
    ?.trim();
  if (!host) return req;
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol)
    .split(",")[0]
    .trim();
  const asal = new URL(`${proto.endsWith(":") ? proto : `${proto}:`}//${host}`);
  const url = new URL(req.url);
  // Ditetapkan satu per satu, bukan `url.host`: menyetel `host` tanpa port
  // membiarkan port lama menempel, jadi `contoh.tld` akan jadi `contoh.tld:9120`.
  url.protocol = asal.protocol;
  url.hostname = asal.hostname;
  url.port = asal.port;
  return new NextRequest(url, req);
}
