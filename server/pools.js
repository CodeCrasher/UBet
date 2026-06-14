import { nanoid } from 'nanoid';
import db from './db.js';
import { getPoolTypes } from './fixtures.js';
import { getFixture, getLive, isLocked, winnerOptions, allFixtures } from './tournament.js';
import { recordTxn, getUserById } from './users.js';
import { provisional, resultFromScore, HOME, DRAW, AWAY } from './settle.js';
import { now, httpError } from './util.js';

const stmt = {
  insertPool: db.prepare(`INSERT OR IGNORE INTO pools (id, fixture_num, type, name, mechanic, fee, rake, cap, status)
    VALUES (@id, @fixture_num, @type, @name, @mechanic, @fee, @rake, @cap, 'open')`),
  byFixture: db.prepare('SELECT * FROM pools WHERE fixture_num = ? ORDER BY rowid'),
  byId: db.prepare('SELECT * FROM pools WHERE id = ?'),
  setSettled: db.prepare("UPDATE pools SET status='settled', settled_at=@ts WHERE id=@id"),
  entriesByPool: db.prepare(`SELECT e.*, u.display_name AS name FROM entries e
    JOIN users u ON u.id = e.user_id WHERE e.pool_id = ? ORDER BY e.created_at, e.rowid`),
  entryByUser: db.prepare('SELECT * FROM entries WHERE pool_id = ? AND user_id = ?'),
  entryCount: db.prepare('SELECT COUNT(*) AS n FROM entries WHERE pool_id = ?'),
  insertEntry: db.prepare(`INSERT INTO entries (id, pool_id, fixture_num, user_id, pred, fee, status, created_at)
    VALUES (@id, @pool_id, @fixture_num, @user_id, @pred, @fee, 'active', @created_at)`),
};

// Seed the five pools for every fixture (idempotent).
export function seedPools() {
  const types = getPoolTypes();
  const tx = db.transaction(() => {
    for (const f of allFixtures()) {
      for (const t of types) {
        stmt.insertPool.run({
          id: `${f.num}:${t.type}`, fixture_num: f.num, type: t.type, name: t.name,
          mechanic: t.mechanic, fee: t.fee, rake: t.rake || 0, cap: t.cap ?? null,
        });
      }
    }
  });
  tx();
}

export const getPool = (id) => stmt.byId.get(id);
export const poolsForFixture = (num) => stmt.byFixture.all(num);
export const entrantCountsByFixture = () =>
  new Map(db.prepare('SELECT fixture_num, COUNT(*) n FROM entries GROUP BY fixture_num').all().map((r) => [r.fixture_num, r.n]));
export const entrantCountsForFixture = (num) =>
  new Map(db.prepare('SELECT pool_id, COUNT(*) n FROM entries WHERE fixture_num = ? GROUP BY pool_id').all(num).map((r) => [r.pool_id, r.n]));
export const entriesForPool = (poolId) => stmt.entriesByPool.all(poolId).map((e) => ({ ...e, pred: JSON.parse(e.pred) }));
export const userEntry = (poolId, userId) => {
  const e = stmt.entryByUser.get(poolId, userId);
  return e ? { ...e, pred: JSON.parse(e.pred) } : null;
};
export const markPoolSettled = (poolId) => stmt.setSettled.run({ id: poolId, ts: now() });

export function effectiveStatus(pool, fixture) {
  if (pool.status === 'settled') return 'settled';
  return isLocked(fixture) ? 'locked' : 'open';
}

// Validate + normalise a prediction for a pool type. Throws on bad input.
export function validatePrediction(pool, fixture, raw = {}) {
  const opts = winnerOptions(fixture);
  const int = (v, max) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) return null;
    return n;
  };
  switch (pool.type) {
    case 'WINNER_BIG':
    case 'WINNER_SMALL': {
      if (!opts.includes(raw.winner)) throw httpError(400, 'Pick a valid result');
      return { winner: raw.winner };
    }
    case 'EXACT': {
      const home = int(raw.home, 30);
      const away = int(raw.away, 30);
      if (home == null || away == null) throw httpError(400, 'Enter both scores (0–30)');
      if (fixture.knockout && home === away) throw httpError(400, 'Knockout exact scores can be level (decided by pens) — but pick the ET scoreline');
      return { home, away };
    }
    case 'TOTAL': {
      const total = int(raw.total, 60);
      if (total == null) throw httpError(400, 'Enter the total goals (0–60)');
      return { total };
    }
    case 'MARGIN': {
      if (!opts.includes(raw.winner)) throw httpError(400, 'Pick a valid result');
      if (raw.winner === DRAW) return { winner: DRAW, margin: 0 };
      const margin = int(raw.margin, 30);
      if (margin == null || margin < 1) throw httpError(400, 'A non-draw pick needs a margin of 1 or more');
      return { winner: raw.winner, margin };
    }
    default:
      throw httpError(400, 'Unknown pool');
  }
}

export function enterPool({ userId, poolId, pred }) {
  const pool = getPool(poolId);
  if (!pool) throw httpError(404, 'Pool not found');
  const fixture = getFixture(pool.fixture_num);
  if (isLocked(fixture)) throw httpError(409, 'This pool is locked — the match has started');
  if (stmt.entryByUser.get(poolId, userId)) throw httpError(409, "You've already entered this pool");
  const clean = validatePrediction(pool, fixture, pred);
  const user = getUserById(userId);
  if (!user || user.balance < pool.fee) throw httpError(402, 'Not enough balance for this entry');

  const id = nanoid(12);
  const tx = db.transaction(() => {
    stmt.insertEntry.run({ id, pool_id: poolId, fixture_num: pool.fixture_num, user_id: userId, pred: JSON.stringify(clean), fee: pool.fee, created_at: now() });
    recordTxn(userId, -pool.fee, 'entry', pool.fixture_num, poolId);
  });
  tx();
  return { ...stmt.entryByUser.get(poolId, userId), pred: clean };
}

/** Standing for a pool: entrants (open) → live provisional → final (settled). */
export function poolStanding(poolId) {
  const pool = getPool(poolId);
  if (!pool) return null;
  const fixture = getFixture(pool.fixture_num);
  const live = getLive(pool.fixture_num);
  const entries = entriesForPool(poolId);
  const status = effectiveStatus(pool, fixture);
  const fee = pool.fee;
  const pot = fee * entries.length;

  let rows;
  let correctCount = 0;
  let projectedPot = pot;
  let refunded = false;

  if (status === 'settled') {
    // final standing from stored results
    correctCount = entries.filter((e) => e.correct).length;
    refunded = entries.length > 0 && correctCount === 0;
    rows = [...entries]
      .sort((a, b) => b.payout - a.payout || String(a.created_at).localeCompare(String(b.created_at)))
      .map((e) => ({
        userId: e.user_id, name: e.name, pred: e.pred,
        correct: !!e.correct, currentlyWinning: false, projectedShare: 0, payout: e.payout,
      }));
  } else if (status === 'locked') {
    // live provisional against the current score
    const result = resultFromScore({ homeGoals: live.home_goals, awayGoals: live.away_goals, knockout: !!fixture.knockout, penWinner: null });
    const pv = provisional({ type: pool.type, entries, fee, rake: pool.rake, result });
    correctCount = pv.correctCount;
    projectedPot = pv.projectedPot;
    rows = pv.rows.map((r) => ({
      userId: r.entry.user_id, name: r.entry.name, pred: r.entry.pred,
      correct: r.correct, currentlyWinning: r.correct, projectedShare: r.projectedShare, payout: 0,
    }));
  } else {
    // open: show entrants + their picks, no leader yet
    rows = entries.map((e) => ({
      userId: e.user_id, name: e.name, pred: e.pred,
      correct: null, currentlyWinning: false, projectedShare: 0, payout: 0,
    }));
  }

  return {
    poolId,
    meta: {
      type: pool.type, name: pool.name, mechanic: pool.mechanic, fee,
      entrantCount: entries.length, pot, projectedPot, status,
      correctCount, refunded,
      live: { homeGoals: live.home_goals, awayGoals: live.away_goals, minute: live.minute, phase: live.phase },
    },
    rows,
  };
}

export { HOME, DRAW, AWAY };
