import db from './db.js';
import { settlePool, resultFromScore } from './settle.js';
import { poolsForFixture, entriesForPool, markPoolSettled } from './pools.js';
import { getFixture, setFixtureResult, resolveKnockouts } from './tournament.js';
import { recordTxn } from './users.js';
import { httpError } from './util.js';

const stmt = {
  updateEntry: db.prepare('UPDATE entries SET status=@status, correct=@correct, payout=@payout WHERE id=@id'),
};

/**
 * Confirm a fixture's final result and run the one-time pari-mutuel settlement.
 * Idempotent: pools already settled are skipped, so re-running yields identical
 * state with no double-payouts.
 */
export function confirmResult({ fixtureNum, homeScore, awayScore, penWinner = null }) {
  const fixture = getFixture(fixtureNum);
  if (!fixture) throw httpError(404, 'Fixture not found');
  if (fixture.home == null || fixture.away == null) throw httpError(409, 'This fixture has no teams resolved yet');
  const h = Number(homeScore);
  const a = Number(awayScore);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) throw httpError(400, 'Enter valid scores');
  let pen = null;
  if (fixture.knockout && h === a) {
    if (penWinner !== fixture.home && penWinner !== fixture.away) throw httpError(400, 'A level knockout needs the penalty-shootout winner');
    pen = penWinner;
  }

  const result = resultFromScore({ homeGoals: h, awayGoals: a, knockout: !!fixture.knockout, penWinner: pen });

  const tx = db.transaction(() => {
    setFixtureResult({ num: fixtureNum, home_score: h, away_score: a, pen_winner: pen, status: 'final', settled: 1 });
    for (const pool of poolsForFixture(fixtureNum)) {
      if (pool.status === 'settled') continue; // idempotent
      const entries = entriesForPool(pool.id);
      const { payouts } = settlePool({ type: pool.type, entries, fee: pool.fee, rake: pool.rake, result });
      for (const p of payouts) {
        const status = p.kind === 'winnings' ? 'won' : p.kind === 'refund' ? 'refunded' : 'lost';
        stmt.updateEntry.run({ id: p.entryId, status, correct: p.correct ? 1 : 0, payout: p.amount });
        if (p.amount > 0) recordTxn(entries.find((e) => e.id === p.entryId).user_id, p.amount, p.kind, fixtureNum, pool.id);
      }
      markPoolSettled(pool.id);
    }
    resolveKnockouts();
  });
  tx();
  return { ok: true, fixtureNum, affectedUsers: affectedUsers(fixtureNum) };
}

function affectedUsers(fixtureNum) {
  return db.prepare('SELECT DISTINCT user_id FROM entries WHERE fixture_num = ?').all(fixtureNum).map((r) => r.user_id);
}
