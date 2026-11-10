import type { MiddlewareHandler } from "hono";
import type { Identitas } from "./session";

export type RateLimitOptions = {
  limit?: number;
  windowMs?: number;
  now?: () => number;
};

/**
 * Middleware rate limiter in-memory berbasis sliding window.
 * Menggunakan identitas GitHub user (`sesi.login`) atau fallback IP.
 */
export function rateLimit(
  options: RateLimitOptions = {},
): MiddlewareHandler<{ Variables: { sesi?: Identitas } }> {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const getNow = options.now ?? (() => Date.now());

  // Map key -> array of request timestamps
  const history = new Map<string, number[]>();

  return async (c, next) => {
    const now = getNow();
    const cutoff = now - windowMs;

    const key =
      c.get("sesi")?.login ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "anonymous";

    const timestamps = (history.get(key) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0];
      const resetDelayMs = Math.max(0, oldest + windowMs - now);
      const resetSec = Math.ceil(resetDelayMs / 1000) || 1;
      const resetTimestampSec = Math.ceil((oldest + windowMs) / 1000);

      c.header("Retry-After", String(resetSec));
      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(resetTimestampSec));

      return c.json(
        {
          ok: false,
          status: 429 as const,
          error: `Terlalu banyak permintaan (maksimal ${limit} aksi per menit). Silakan tunggu sebentar.`,
        },
        429,
      );
    }

    timestamps.push(now);
    history.set(key, timestamps);

    const remaining = Math.max(0, limit - timestamps.length);
    const resetTimestampSec = Math.ceil((timestamps[0] + windowMs) / 1000);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetTimestampSec));

    await next();
  };
}
