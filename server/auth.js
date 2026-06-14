import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  if (!password || !hash || !salt) return false;
  const candidate = scryptSync(String(password), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return candidate.length === known.length && timingSafeEqual(candidate, known);
}

export function newToken() {
  return randomBytes(24).toString('hex');
}

// PIN-gated admin. Set ADMIN_PIN in prod; defaults to 2026 for local/demo.
export function verifyAdminPin(pin) {
  const expected = process.env.ADMIN_PIN || '2026';
  if (!pin) return false;
  const a = Buffer.from(String(pin));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
