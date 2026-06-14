// End-to-end domain test over a throwaway SQLite DB: register → enter → live
// provisional → confirm settlement → earnings reconcile → idempotent re-run.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `ubet-flow-${process.pid}.db`);
process.env.DATABASE_PATH = DB;

let T;
before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
  const tournament = await import('../../server/tournament.js');
  const pools = await import('../../server/pools.js');
  const users = await import('../../server/users.js');
  const settlement = await import('../../server/settlement.js');
  const liveboard = await import('../../server/liveboard.js');
  const earnings = await import('../../server/earnings.js');
  tournament.loadFixtures();
  pools.seedPools();
  T = { tournament, pools, users, settlement, liveboard, earnings };
});

function openFixtureNum() {
  return T.tournament.allFixtures().find((f) => f.home && f.away && !T.tournament.isLocked(f)).num;
}

test('enter → live provisional → settle → earnings reconcile', () => {
  const a = T.users.register({ email: 'a@t.com', password: 'password', displayName: 'A' });
  const b = T.users.register({ email: 'b@t.com', password: 'password', displayName: 'B' });
  const num = openFixtureNum();
  const poolId = `${num}:WINNER_BIG`;

  T.pools.enterPool({ userId: a.id, poolId, pred: { winner: 'HOME' } });
  T.pools.enterPool({ userId: b.id, poolId, pred: { winner: 'AWAY' } });
  assert.equal(T.users.getUserById(a.id).balance, 99000, 'fee debited');

  // live: home leading → A currently winning, projected whole pot
  T.liveboard.setLiveScore({ fixtureNum: num, homeGoals: 1, awayGoals: 0, minute: 30, phase: 'FIRST_HALF' });
  const live = T.pools.poolStanding(poolId);
  assert.equal(live.meta.status, 'locked');
  assert.equal(live.rows[0].currentlyWinning, true);
  assert.equal(live.rows[0].userId, a.id);
  assert.equal(live.rows[0].projectedShare, 2000);

  // confirm 2-0 home → A wins the pot
  T.settlement.confirmResult({ fixtureNum: num, homeScore: 2, awayScore: 0 });
  const settled = T.pools.poolStanding(poolId);
  assert.equal(settled.meta.status, 'settled');
  assert.equal(T.users.getUserById(a.id).balance, 101000, 'won pot 2000 (net +1000)');
  assert.equal(T.users.getUserById(b.id).balance, 99000, 'B lost fee');

  // earnings reconcile: A net = +1000, B net = -1000; rows sum to totals
  const ea = T.earnings.breakdown(a.id);
  assert.equal(ea.total, 1000);
  assert.equal(ea.rows.reduce((s, r) => s + r.net, 0), 1000);
  assert.equal(T.earnings.totalEarnings(b.id), -1000);
});

test('settlement is idempotent (no double pay)', () => {
  const num = openFixtureNum();
  const before = T.users.getUserById(T.users.getUserByEmail('a@t.com').id).balance;
  T.settlement.confirmResult({ fixtureNum: num, homeScore: 2, awayScore: 0 });
  const after = T.users.getUserById(T.users.getUserByEmail('a@t.com').id).balance;
  assert.equal(after, before, 're-confirm does not change balances');
});

test('zero correct → everyone refunded', () => {
  const c = T.users.register({ email: 'c@t.com', password: 'password', displayName: 'C' });
  const d = T.users.register({ email: 'd@t.com', password: 'password', displayName: 'D' });
  // a different open fixture's EXACT pool
  const nums = T.tournament.allFixtures().filter((f) => f.home && f.away && !T.tournament.isLocked(f)).map((f) => f.num);
  const num = nums[1];
  const poolId = `${num}:EXACT`;
  T.pools.enterPool({ userId: c.id, poolId, pred: { home: 5, away: 5 } });
  T.pools.enterPool({ userId: d.id, poolId, pred: { home: 4, away: 4 } });
  const balBefore = T.users.getUserById(c.id).balance;
  T.settlement.confirmResult({ fixtureNum: num, homeScore: 1, awayScore: 0 });
  assert.equal(T.users.getUserById(c.id).balance, balBefore + 500, 'refunded the entry fee');
  assert.equal(T.earnings.totalEarnings(c.id), 0, 'net zero after refund');
  const st = T.pools.poolStanding(poolId);
  assert.equal(st.meta.refunded, true);
});
