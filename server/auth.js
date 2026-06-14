import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

// Secret for signing short-lived host-session tokens. Set SESSION_SECRET in
// production so tokens survive restarts; otherwise it rotates per boot (hosts
// just re-enter their PIN after a redeploy).
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const HOST_TTL_MS = Number(process.env.HOST_SESSION_TTL_MS) || 8 * 60 * 60 * 1000;

// A host token is `{exp}.{hmac(poolId.exp)}` — stateless, expiring, per-pool.
export function signHostToken(poolId, ttlMs = HOST_TTL_MS) {
  const exp = Date.now() + ttlMs;
  const sig = createHmac('sha256', SECRET).update(`${poolId}.${exp}`).digest('hex');
  return { token: `${exp}.${sig}`, expiresAt: new Date(exp).toISOString() };
}

export function verifyHostToken(poolId, token) {
  if (!token) return false;
  const [expStr, sig] = String(token).split('.');
  const exp = Number(expStr);
  if (!exp || Date.now() > exp || !sig) return false;
  const expect = createHmac('sha256', SECRET).update(`${poolId}.${exp}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expect, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(pin), salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPin(pin, hash, salt) {
  if (!pin || !hash || !salt) return false;
  const candidate = scryptSync(String(pin), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return candidate.length === known.length && timingSafeEqual(candidate, known);
}

export function newToken() {
  return randomBytes(24).toString('hex');
}
