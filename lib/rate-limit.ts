// A single Node process serves this app (see server.js), so an in-memory
// map is enough to stop brute-forcing/spamming for a pilot deployment. If
// this ever runs as multiple server instances behind a load balancer,
// swap this for a shared store (e.g. Redis) — each instance would
// otherwise track limits independently.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup so the map doesn't grow forever.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref?.();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limit. `key` should already include both the route and
 * the client identifier (e.g. "login:203.0.113.5") so different endpoints
 * don't share a budget.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/**
 * Resolves the real client IP. `x-real-ip` is set by our own server.js from
 * the raw socket address, so it's trustworthy; `x-forwarded-for` is used as
 * a fallback for `next dev` (no proxy in front) or a real reverse proxy in
 * production, but since a client could forge it, only trust it when nothing
 * more reliable is available.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

/** Standard 429 JSON response with a Retry-After header. */
export function rateLimitResponse(result: RateLimitResult) {
  return new Response(JSON.stringify({ error: 'Too many requests. Please try again shortly.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(result.retryAfterSeconds),
    },
  });
}
