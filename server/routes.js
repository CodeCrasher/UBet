import { Router } from 'express';
import { verifyPin } from './auth.js';
import { pushPoolUpdate } from './realtime.js';
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
    }),
  );

  r.post('/pools', wrap((req, res) => {
    const { name, buyIn, currency, rules, pin, hostName } = req.body || {};
    if (!pin || String(pin).length < 4) throw httpError(400, 'Host PIN must be at least 4 digits');
    const { pool, host } = createPool({ name, buyIn, currency, rules, pin, hostName });
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

  // JSON error handler — catches errors passed via next() from middleware.
  r.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  });

  return r;
}
