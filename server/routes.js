import { Router } from 'express';
import { verifyPin } from './auth.js';
import { pushPoolUpdate } from './realtime.js';
import { syncEnabled, activeProvider, runSync } from './sync.js';
import {
  createPool,
  joinPool,
  getPoolByCode,
  getPlayerByToken,
  buildState,
  submitPrediction,
  enterResult,
  clearResult,
  setMatchLock,
  setPlayerPaid,
  updateSettings,
  createCustomBet,
  updateCustomBet,
  deleteCustomBet,
  answerCustomBet,
  httpError,
} from './pools.js';

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  }
};

export function createApiRouter(io) {
  const r = Router();

  // ── middleware ──
  const resolvePool = (req, _res, next) => {
    const pool = getPoolByCode(req.params.code);
    if (!pool) return next(httpError(404, 'Pool not found'));
    req.pool = pool;
    next();
  };

  const requirePlayer = (req, _res, next) => {
    const token = req.get('x-player-token');
    const player = getPlayerByToken(token);
    if (!player || player.pool_id !== req.pool.id) return next(httpError(401, 'Not a member of this pool'));
    req.player = player;
    next();
  };

  const requireHost = (req, _res, next) => {
    const pin = req.get('x-host-pin');
    if (!verifyPin(pin, req.pool.pin_hash, req.pool.pin_salt)) return next(httpError(403, 'Invalid host PIN'));
    next();
  };

  // ── public ──
  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.get('/config', (_req, res) =>
    res.json({
      defaultBuyIn: Number(process.env.DEFAULT_BUY_IN) || 20,
      defaultCurrency: process.env.DEFAULT_CURRENCY || 'USD',
      sync: { enabled: syncEnabled(), provider: activeProvider()?.label || null },
    }),
  );

  r.post('/pools', wrap((req, res) => {
    const { name, buyIn, currency, rules, pin, hostName, manual } = req.body || {};
    if (!pin || String(pin).length < 4) throw httpError(400, 'Host PIN must be at least 4 digits');
    // When a live provider is configured, new pools auto-sync results unless the
    // host explicitly opts into manual result entry.
    const synced = syncEnabled() && !manual;
    const { pool, host } = createPool({ name, buyIn, currency, rules, pin, hostName, synced });
    res.status(201).json({
      pool: { code: pool.code, name: pool.name },
      token: host.token,
      playerId: host.id,
      isHost: true,
    });
  }));

  // lightweight preview for the join screen
  r.get('/pools/:code', resolvePool, wrap((req, res) => {
    res.json({
      code: req.pool.code,
      name: req.pool.name,
      buyIn: req.pool.buy_in,
      currency: req.pool.currency,
      status: req.pool.status,
    });
  }));

  r.post('/pools/:code/join', resolvePool, wrap((req, res) => {
    const { displayName } = req.body || {};
    const { player } = joinPool({ code: req.pool.code, displayName });
    pushPoolUpdate(io, req.pool.id);
    res.status(201).json({ token: player.token, playerId: player.id, isHost: false });
  }));

  r.get('/pools/:code/state', resolvePool, wrap((req, res) => {
    const player = getPlayerByToken(req.get('x-player-token'));
    const viewerId = player && player.pool_id === req.pool.id ? player.id : null;
    res.json(buildState(req.pool.id, viewerId));
  }));

  r.post('/pools/:code/verify-pin', resolvePool, wrap((req, res) => {
    const ok = verifyPin(req.body?.pin, req.pool.pin_hash, req.pool.pin_salt);
    res.json({ ok });
  }));

  // ── player actions ──
  r.post('/pools/:code/predictions', resolvePool, requirePlayer, wrap((req, res) => {
    const { num, home, away } = req.body || {};
    const pred = submitPrediction({ poolId: req.pool.id, playerId: req.player.id, num: Number(num), home, away });
    pushPoolUpdate(io, req.pool.id, Number(num));
    res.json({ num: Number(num), home: pred.home_pred, away: pred.away_pred, points: pred.points });
  }));

  // ── host actions (PIN-gated) ──
  r.post('/pools/:code/results', resolvePool, requireHost, wrap((req, res) => {
    const { num, homeScore, awayScore, penWinner } = req.body || {};
    enterResult({ poolId: req.pool.id, num: Number(num), homeScore, awayScore, penWinner });
    pushPoolUpdate(io, req.pool.id, Number(num));
    res.json({ ok: true });
  }));

  r.delete('/pools/:code/results/:num', resolvePool, requireHost, wrap((req, res) => {
    clearResult({ poolId: req.pool.id, num: Number(req.params.num) });
    pushPoolUpdate(io, req.pool.id, Number(req.params.num));
    res.json({ ok: true });
  }));

  r.post('/pools/:code/matches/:num/lock', resolvePool, requireHost, wrap((req, res) => {
    setMatchLock({ poolId: req.pool.id, num: Number(req.params.num), locked: !!req.body?.locked });
    pushPoolUpdate(io, req.pool.id, Number(req.params.num));
    res.json({ ok: true });
  }));

  r.post('/pools/:code/players/:id/paid', resolvePool, requireHost, wrap((req, res) => {
    setPlayerPaid(req.pool.id, req.params.id, !!req.body?.paid);
    pushPoolUpdate(io, req.pool.id);
    res.json({ ok: true });
  }));

  r.patch('/pools/:code/settings', resolvePool, requireHost, wrap((req, res) => {
    const { name, buyIn, currency, rules } = req.body || {};
    updateSettings({ poolId: req.pool.id, name, buyIn, currency, rules });
    pushPoolUpdate(io, req.pool.id);
    res.json({ ok: true });
  }));

  // ── custom bets (pool-level prop bets) ──
  r.post('/pools/:code/custom-bets', resolvePool, requireHost, wrap((req, res) => {
    const { question, options, points } = req.body || {};
    const bet = createCustomBet({ poolId: req.pool.id, question, options, points });
    pushPoolUpdate(io, req.pool.id);
    res.status(201).json({ id: bet.id });
  }));

  r.patch('/pools/:code/custom-bets/:id', resolvePool, requireHost, wrap((req, res) => {
    const { question, options, points, answer } = req.body || {};
    updateCustomBet({ poolId: req.pool.id, betId: req.params.id, question, options, points, answer });
    pushPoolUpdate(io, req.pool.id);
    res.json({ ok: true });
  }));

  r.delete('/pools/:code/custom-bets/:id', resolvePool, requireHost, wrap((req, res) => {
    deleteCustomBet({ poolId: req.pool.id, betId: req.params.id });
    pushPoolUpdate(io, req.pool.id);
    res.json({ ok: true });
  }));

  r.post('/pools/:code/custom-bets/:id/answer', resolvePool, requirePlayer, wrap((req, res) => {
    answerCustomBet({ poolId: req.pool.id, betId: req.params.id, playerId: req.player.id, answer: req.body?.answer });
    pushPoolUpdate(io, req.pool.id);
    res.json({ ok: true });
  }));

  // Force an immediate pull from the live provider (host-gated).
  r.post('/pools/:code/resync', resolvePool, requireHost, wrap(async (_req, res) => {
    if (!syncEnabled()) throw httpError(409, 'Live sync is not enabled on this server');
    const result = await runSync(io, { force: true });
    res.json(result);
  }));

  // JSON error handler — catches errors passed via next() from middleware.
  r.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  });

  return r;
}
