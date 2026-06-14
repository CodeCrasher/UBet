import { nanoid } from 'nanoid';
import db from './db.js';
import { hashPassword, verifyPassword, newToken } from './auth.js';
import { now, httpError } from './util.js';

export const STARTING_BALANCE = Number(process.env.STARTING_BALANCE) || 100000;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 30d

const stmt = {
  byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare(`INSERT INTO users (id, email, pw_hash, pw_salt, display_name, balance, is_admin, created_at)
    VALUES (@id, @email, @pw_hash, @pw_salt, @display_name, @balance, @is_admin, @created_at)`),
  setBalance: db.prepare('UPDATE users SET balance = balance + @delta WHERE id = @id'),
  insertSession: db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (@id, @user_id, @created_at, @expires_at)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  insertLedger: db.prepare(`INSERT INTO ledger (id, user_id, fixture_num, pool_id, kind, amount, created_at)
    VALUES (@id, @user_id, @fixture_num, @pool_id, @kind, @amount, @created_at)`),
};

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, displayName: u.display_name, balance: u.balance, isAdmin: !!u.is_admin };
}

export function getUserById(id) {
  return stmt.byId.get(id);
}

export function getUserByEmail(email) {
  return stmt.byEmail.get(String(email || '').trim().toLowerCase());
}

export function register({ email, password, displayName }) {
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw httpError(400, 'Enter a valid email');
  if (!password || String(password).length < 6) throw httpError(400, 'Password must be at least 6 characters');
  const name = String(displayName || '').trim().slice(0, 32) || mail.split('@')[0];
  if (stmt.byEmail.get(mail)) throw httpError(409, 'An account with that email already exists');
  const { hash, salt } = hashPassword(password);
  const id = nanoid(12);
  const ts = now();
  const tx = db.transaction(() => {
    stmt.insertUser.run({
      id, email: mail, pw_hash: hash, pw_salt: salt, display_name: name,
      balance: STARTING_BALANCE, is_admin: 0, created_at: ts,
    });
    stmt.insertLedger.run({ id: nanoid(12), user_id: id, fixture_num: null, pool_id: null, kind: 'grant', amount: STARTING_BALANCE, created_at: ts });
  });
  tx();
  return stmt.byId.get(id);
}

export function login({ email, password }) {
  const u = stmt.byEmail.get(String(email || '').trim().toLowerCase());
  if (!u || !verifyPassword(password, u.pw_hash, u.pw_salt)) throw httpError(401, 'Wrong email or password');
  return u;
}

// ── sessions ──
export function createSession(userId) {
  const id = newToken();
  const ts = now();
  stmt.insertSession.run({ id, user_id: userId, created_at: ts, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  return { token: id, maxAgeMs: SESSION_TTL_MS };
}

export function userForSession(token) {
  if (!token) return null;
  const s = stmt.getSession.get(token);
  if (!s) return null;
  if (Date.now() > new Date(s.expires_at).getTime()) {
    stmt.deleteSession.run(token);
    return null;
  }
  return stmt.byId.get(s.user_id) || null;
}

export function destroySession(token) {
  if (token) stmt.deleteSession.run(token);
}

// ── money (caller wraps in a transaction) ──
export function recordTxn(userId, amount, kind, fixtureNum = null, poolId = null) {
  stmt.setBalance.run({ id: userId, delta: amount });
  stmt.insertLedger.run({ id: nanoid(12), user_id: userId, fixture_num: fixtureNum, pool_id: poolId, kind, amount, created_at: now() });
}
