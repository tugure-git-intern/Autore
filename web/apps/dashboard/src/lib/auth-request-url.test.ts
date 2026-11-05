import { NextRequest } from "next/server";
import { expect, test } from "vitest";
import { denganHostAsli } from "./auth-request-url";

/** Hanya bagian init yang dipakai tes ini — bukan `RequestInit` penuh, supaya
 *  tidak bertabrakan dengan tipe `init` milik `NextRequest` (yang `signal`-nya
 *  boleh `null`). */
function minta(url: string, headers: Record<string, string> = {}, init: { method?: string; body?: string } = {}) {
  return new NextRequest(url, { ...init, headers });
}

test("origin diganti jadi host yang dipakai browser", () => {
  const hasil = denganHostAsli(
    minta("http://localhost:9120/api/auth/callback/github", { host: "100.80.3.14:9120" }),
  );

  expect(hasil.url).toBe("http://100.80.3.14:9120/api/auth/callback/github");
  expect(hasil.nextUrl.origin).toBe("http://100.80.3.14:9120");
});

test("x-forwarded-host dipakai saat Host tidak ada", () => {
  const hasil = denganHostAsli(
    minta("http://localhost:9120/api/auth/session", { "x-forwarded-host": "autore.tugu-re.com" }),
  );

  expect(hasil.nextUrl.host).toBe("autore.tugu-re.com");
});

test("host beruntun dari proxy diambil yang pertama", () => {
  const hasil = denganHostAsli(
    minta("http://localhost:9120/api/auth/session", { host: "depan.tld, belakang.tld" }),
  );

  expect(hasil.nextUrl.host).toBe("depan.tld");
});

test("x-forwarded-proto menentukan skema, tanpa itu protokol permintaan dipakai", () => {
  const denganHeader = denganHostAsli(
    minta("http://localhost:9120/api/auth/session", { host: "contoh.tld", "x-forwarded-proto": "https" }),
  );
  expect(denganHeader.nextUrl.protocol).toBe("https:");

  const tanpaHeader = denganHostAsli(minta("http://localhost:9120/api/auth/session", { host: "contoh.tld" }));
  expect(tanpaHeader.nextUrl.protocol).toBe("http:");
});

test("metode, header, dan badan POST tidak hilang", async () => {
  const hasil = denganHostAsli(
    minta(
      "http://localhost:9120/api/auth/signin/github",
      { host: "100.80.3.14:9120", "content-type": "application/x-www-form-urlencoded" },
      { method: "POST", body: "csrfToken=x&callbackUrl=%2F" },
    ),
  );

  expect(hasil.method).toBe("POST");
  expect(hasil.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
  expect(await hasil.text()).toBe("csrfToken=x&callbackUrl=%2F");
});

test("port mengikuti Host, bukan port internal", () => {
  const hasil = denganHostAsli(minta("http://localhost:9120/api/auth/session", { host: "contoh.tld" }));

  expect(hasil.nextUrl.origin).toBe("http://contoh.tld");
});

test("tanpa host sama sekali, permintaan dikembalikan apa adanya", () => {
  const req = minta("http://localhost:9120/api/auth/session");

  expect(denganHostAsli(req)).toBe(req);
});
