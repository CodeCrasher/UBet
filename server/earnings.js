import db from './db.js';
import { teamMap } from './fixtures.js';

const stmt = {
  byUser: db.prepare(`SELECT l.*, p.type AS pool_type, p.name AS pool_name
    FROM ledger l LEFT JOIN pools p ON p.id = l.pool_id
    WHERE l.user_id = ? AND l.kind != 'grant' ORDER BY l.created_at`),
  fixtures: db.prepare('SELECT num, home, away, round, kickoff FROM fixtures'),
  entries: db.prepare('SELECT pool_id, status, correct, payout, fee FROM entries WHERE user_id = ?'),
};

// Running total earnings = winnings + refunds − entry fees (excludes the grant).
export function totalEarnings(userId) {
  let total = 0;
  for (const l of stmt.byUser.all(userId)) total += l.amount;
  return total;
}

/**
 * Itemised breakdown: one row per pool the user entered, with fee, gross
 * (winnings/refund), correct flag, and net. Rows sum to totalEarnings.
 */
export function breakdown(userId) {
  const tmap = teamMap();
  const fxByNum = new Map(stmt.fixtures.all().map((f) => [f.num, f]));
  const entries = stmt.entries.all(userId);
  const credits = new Map(); // pool_id -> {kind, amount}
  let totalNet = 0;
  for (const l of stmt.byUser.all(userId)) {
    if (l.kind === 'winnings' || l.kind === 'refund') credits.set(l.pool_id, { kind: l.kind, amount: l.amount });
    totalNet += l.amount;
  }

  const rows = entries.map((e) => {
    const poolNum = Number(e.pool_id.split(':')[0]);
    const f = fxByNum.get(poolNum);
    const credit = credits.get(e.pool_id);
    const gross = credit ? credit.amount : 0;
    const fixtureLabel = f && f.home && f.away
      ? `${tmap.get(f.home)?.name || f.home} v ${tmap.get(f.away)?.name || f.away}`
      : f ? f.round : `Match ${poolNum}`;
    return {
      poolId: e.pool_id,
      fixtureNum: poolNum,
      fixture: fixtureLabel,
      poolType: e.pool_id.split(':')[1],
      status: e.status,
      correct: !!e.correct,
      refunded: credit?.kind === 'refund',
      fee: e.fee,
      gross,
      net: gross - e.fee,
    };
  }).sort((a, b) => a.fixtureNum - b.fixtureNum || a.poolId.localeCompare(b.poolId));

  return { total: totalNet, rows };
}
