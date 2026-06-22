import { Router } from 'express';
import {
  register, login, publicUser, getUserById,
  createSession, userForSession, destroySession,
  createResetToken, resetPasswordWithToken,
} from './users.js';
import { verifyAdminPin } from './auth.js';
import { checkLimit, recordFail, recordSuccess } from './ratelimit.js';
import {
  allFixtures, getFixture, getLive, isLocked, winnerOptions, sourceLabel, resolveKnockouts, resyncFixtures,
} from './tournament.js';
import {
  poolsForFixture, getPool, userEntry, poolStanding, enterPool, effectiveStatus,
  entrantCountsByFixture, entrantCountsForFixture,
} from './pools.js';
import { teamMap } from './fixtures.js';
import { confirmResult } from './settlement.js';
import { setLiveScore } from './liveboard.js';
import { totalEarnings, breakdown } from './earnings.js';
import { pushPool, pushFixture, pushFixtureBoards, pushUserEarnings } from './realtime.js';
import { httpError } from './util.js';

const COOKIE = 'ubet_session';
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  }
};

function teamObj(tmap, code) {
  if (!code) return null;
  const t = tmap.get(code);
  return t ? { code: t.code, name: t.name, flag: t.flag } : { code, name: code, flag: '🏳️' };
}

export function createApiRouter(io) {
  const r = Router();
  const tmap = teamMap();

  // ── card builders ──
  function fixtureCard(f, entrantCounts) {
    const live = getLive(f.num);
    return {
      num: f.num, stage: f.stage, round: f.round, group: f.group_name, matchday: f.matchday,
      knockout: !!f.knockout, kickoff: f.kickoff, venue: f.venue ?? null, status: f.status,
      homeTeam: teamObj(tmap, f.home), awayTeam: teamObj(tmap, f.away),
      homeLabel: f.home ? (tmap.get(f.home)?.name || f.home) : sourceLabel(f.home_source),
      awayLabel: f.away ? (tmap.get(f.away)?.name || f.away) : sourceLabel(f.away_source),
      homeScore: f.home_score, awayScore: f.away_score, penWinner: f.pen_winner,
      locked: isLocked(f),
      live: { homeGoals: live.home_goals, awayGoals: live.away_goals, minute: live.minute, phase: live.phase },
      entrants: entrantCounts.get(f.num) || 0,
    };
  }

  function poolSummary(pool, fixture, counts, userId) {
    const n = counts.get(pool.id) || 0;
    return {
      id: pool.id, type: pool.type, name: pool.name, mechanic: pool.mechanic, fee: pool.fee,
      status: effectiveStatus(pool, fixture), entrantCount: n, pot: n * pool.fee,
      entered: userId ? !!userEntry(pool.id, userId) : false,
    };
  }

  // ── auth middleware ──
  const requireUser = (req, _res, next) => {
    const u = userForSession(req.cookies?.[COOKIE]);
    if (!u) return next(httpError(401, 'Please log in'));
    req.user = u;
    next();
  };
  const requireAdmin = (req, _res, next) => {
    const key = `admin:${req.ip}`;
    const { allowed, retryAfter } = checkLimit(key);
    if (!allowed) return next(httpError(429, `Too many attempts — wait ${retryAfter}s`));
    if (!verifyAdminPin(req.get('x-admin-pin'))) {
      recordFail(key);
      return next(httpError(403, 'Invalid admin PIN'));
    }
    recordSuccess(key);
    next();
  };
  const setCookie = (res, token, maxAgeMs) =>
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      maxAge: maxAgeMs, path: '/',
    });

  // ── auth ──
  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.post('/auth/register', wrap((req, res) => {
    const { email, password, displayName } = req.body || {};
    const user = register({ email, password, displayName });
    const { token, maxAgeMs } = createSession(user.id);
    setCookie(res, token, maxAgeMs);
    res.status(201).json({ user: publicUser(user) });
  }));

  r.post('/auth/login', wrap((req, res) => {
    const key = `login:${req.ip}`;
    const { allowed, retryAfter } = checkLimit(key);
    if (!allowed) throw httpError(429, `Too many attempts — wait ${retryAfter}s`);
    let user;
    try {
      user = login(req.body || {});
    } catch (e) {
      recordFail(key);
      throw e;
    }
    recordSuccess(key);
    const { token, maxAgeMs } = createSession(user.id);
    setCookie(res, token, maxAgeMs);
    res.json({ user: publicUser(user) });
  }));

  r.post('/auth/logout', wrap((req, res) => {
    destroySession(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  r.get('/auth/me', wrap((req, res) => {
    const u = userForSession(req.cookies?.[COOKIE]);
    res.json({ user: u ? publicUser(u) : null });
  }));

  r.post('/auth/forgot-password', wrap((req, res) => {
    const key = `forgot:${req.ip}`;
    const { allowed, retryAfter } = checkLimit(key);
    if (!allowed) throw httpError(429, `Too many attempts — wait ${retryAfter}s`);
    const { email } = req.body || {};
    try {
      const token = createResetToken(email);
      recordSuccess(key);
      res.json({ token });
    } catch (e) {
      recordFail(key);
      throw e;
    }
  }));

  r.post('/auth/reset-password', wrap((req, res) => {
    const key = `reset:${req.ip}`;
    const { allowed, retryAfter } = checkLimit(key);
    if (!allowed) throw httpError(429, `Too many attempts — wait ${retryAfter}s`);
    const { token, password } = req.body || {};
    try {
      resetPasswordWithToken(token, password);
      recordSuccess(key);
      res.json({ ok: true });
    } catch (e) {
      recordFail(key);
      throw e;
    }
  }));

  // ── fixtures ──
  r.get('/fixtures', wrap((req, res) => {
    const counts = entrantCountsByFixture();
    res.json({ fixtures: allFixtures().map((f) => fixtureCard(f, counts)) });
  }));

  r.get('/fixtures/:num', wrap((req, res) => {
    const num = Number(req.params.num);
    const f = getFixture(num);
    if (!f) throw httpError(404, 'Fixture not found');
    const u = userForSession(req.cookies?.[COOKIE]);
    const counts = entrantCountsForFixture(num);
    const pools = poolsForFixture(num).map((p) => poolSummary(p, f, counts, u?.id));
    res.json({
      fixture: fixtureCard(f, new Map([[num, [...counts.values()].reduce((s, n) => s + n, 0)]])),
      pools,
      winnerOptions: winnerOptions(f),
    });
  }));

  // ── pools ──
  r.get('/pools/:id', wrap((req, res) => {
    const pool = getPool(req.params.id);
    if (!pool) throw httpError(404, 'Pool not found');
    const f = getFixture(pool.fixture_num);
    const u = userForSession(req.cookies?.[COOKIE]);
    const standing = poolStanding(pool.id);
    res.json({
      standing,
      fixture: fixtureCard(f, new Map()),
      myEntry: u ? userEntry(pool.id, u.id) : null,
      winnerOptions: winnerOptions(f),
      me: u ? u.id : null,
    });
  }));

  r.post('/pools/:id/enter', requireUser, wrap((req, res) => {
    const entry = enterPool({ userId: req.user.id, poolId: req.params.id, pred: req.body?.pred });
    const pool = getPool(req.params.id);
    pushPool(io, pool.id);
    pushFixture(io, pool.fixture_num);
    pushUserEarnings(io, req.user.id);
    res.status(201).json({ entry, balance: getUserById(req.user.id).balance });
  }));

  // ── earnings ──
  r.get('/me/earnings', requireUser, wrap((req, res) => {
    res.json({ total: totalEarnings(req.user.id), balance: getUserById(req.user.id).balance });
  }));
  r.get('/me/earnings/breakdown', requireUser, wrap((req, res) => {
    res.json(breakdown(req.user.id));
  }));

  // ── admin (PIN-gated) ──
  r.post('/admin/check', requireAdmin, (_req, res) => res.json({ ok: true }));

  r.post('/admin/fixtures/:num/live', requireAdmin, wrap((req, res) => {
    const num = Number(req.params.num);
    const { homeGoals, awayGoals, minute, phase } = req.body || {};
    setLiveScore({ fixtureNum: num, homeGoals, awayGoals, minute, phase });
    pushFixture(io, num);
    pushFixtureBoards(io, num);
    res.json({ ok: true, live: getLive(num) });
  }));

  r.post('/admin/fixtures/:num/result', requireAdmin, wrap((req, res) => {
    const num = Number(req.params.num);
    const { homeScore, awayScore, penWinner } = req.body || {};
    const { affectedUsers } = confirmResult({ fixtureNum: num, homeScore, awayScore, penWinner });
    pushFixture(io, num);
    pushFixtureBoards(io, num);
    for (const uid of affectedUsers) pushUserEarnings(io, uid);
    res.json({ ok: true });
  }));

  r.post('/admin/resolve-knockouts', requireAdmin, wrap((_req, res) => {
    resolveKnockouts();
    res.json({ ok: true });
  }));

  // Break-glass: push the committed schedule (real kickoffs + venues) into the
  // DB on an already-seeded volume, then re-resolve the bracket. Only refreshes
  // kickoff/venue for upcoming, unsettled fixtures — never results or user data.
  r.post('/admin/resync-fixtures', requireAdmin, wrap((_req, res) => {
    const count = resyncFixtures();
    resolveKnockouts();
    res.json({ ok: true, message: `Fixtures resynced from latest schedule (${count} fixtures: kickoffs + venues)` });
  }));

  r.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  });

  return r;
}
