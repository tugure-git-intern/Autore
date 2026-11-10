import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "./rate-limit";
import type { Identitas } from "./session";

describe("rateLimit middleware", () => {
  it("mengizinkan hingga batas maksimum dalam satu jendela waktu", async () => {
    let now = 1000;
    const app = new Hono<{ Variables: { sesi: Identitas } }>();
    app.use("*", async (c, next) => {
      c.set("sesi", { login: "alif", nama: "Alif", email: "alif@test.local" });
      await next();
    });
    app.use("*", rateLimit({ limit: 3, windowMs: 60_000, now: () => now }));
    app.post("/test", (c) => c.json({ ok: true }));

    // 3 request pertama sukses
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/test", { method: "POST" });
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(2 - i));
    }

    // Request ke-4 diblokir 429
    const blocked = await app.request("/test", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(blocked.headers.get("Retry-After")).toBe("60");
    const body = await blocked.json();
    expect(body).toEqual({
      ok: false,
      status: 429,
      error: "Terlalu banyak permintaan (maksimal 3 aksi per menit). Silakan tunggu sebentar.",
    });
  });

  it("mereset kuota setelah jendela waktu lewat", async () => {
    let now = 1000;
    const app = new Hono<{ Variables: { sesi: Identitas } }>();
    app.use("*", async (c, next) => {
      c.set("sesi", { login: "alif", nama: "Alif", email: "alif@test.local" });
      await next();
    });
    app.use("*", rateLimit({ limit: 2, windowMs: 60_000, now: () => now }));
    app.post("/test", (c) => c.json({ ok: true }));

    await app.request("/test", { method: "POST" });
    await app.request("/test", { method: "POST" });
    const blocked = await app.request("/test", { method: "POST" });
    expect(blocked.status).toBe(429);

    // Majukan waktu 61 detik
    now += 61_000;
    const fresh = await app.request("/test", { method: "POST" });
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("X-RateLimit-Remaining")).toBe("1");
  });

  it("membedakan kuota antar pengguna", async () => {
    let user = "alif";
    const app = new Hono<{ Variables: { sesi: Identitas } }>();
    app.use("*", async (c, next) => {
      c.set("sesi", { login: user, nama: user, email: `${user}@test.local` });
      await next();
    });
    app.use("*", rateLimit({ limit: 1, windowMs: 60_000 }));
    app.post("/test", (c) => c.json({ ok: true }));

    // User alif pakai kuota
    const r1 = await app.request("/test", { method: "POST" });
    expect(r1.status).toBe(200);
    const r2 = await app.request("/test", { method: "POST" });
    expect(r2.status).toBe(429);

    // Ganti user ke budi: kuota masih ada
    user = "budi";
    const r3 = await app.request("/test", { method: "POST" });
    expect(r3.status).toBe(200);
  });
});
