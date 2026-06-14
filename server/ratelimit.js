// Tiny in-memory rate limiter with lockout — enough to stop PIN brute-force on
// a single-instance service. Keyed by caller (pool + IP). No dependencies.

const buckets = new Map(); // key -> { fails, firstFailAt, lockedUntil }

function getBucket(key) {
  let b = buckets.get(key);
  if (!b) {
    b = { fails: 0, firstFailAt: 0, lockedUntil: 0 };
    buckets.set(key, b);
  }
  return b;
}

/**
 * @returns {{ allowed: boolean, retryAfter: number }} retryAfter in seconds.
 */
export function checkLimit(key) {
  const b = buckets.get(key);
  if (b && b.lockedUntil > Date.now()) {
    return { allowed: false, retryAfter: Math.ceil((b.lockedUntil - Date.now()) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Record a failed attempt; lock the key after `max` fails within `windowMs`. */
export function recordFail(key, { max = 5, windowMs = 120_000, lockMs = 300_000 } = {}) {
  const now = Date.now();
  const b = getBucket(key);
  if (now - b.firstFailAt > windowMs) {
    b.fails = 0;
    b.firstFailAt = now;
  }
  b.fails += 1;
  if (b.fails >= max) {
    b.lockedUntil = now + lockMs;
    b.fails = 0;
  }
}

/** Clear the key on success. */
export function recordSuccess(key) {
  buckets.delete(key);
}

// Periodic cleanup so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.lockedUntil < now && now - b.firstFailAt > 600_000) buckets.delete(k);
  }
}, 600_000).unref?.();
