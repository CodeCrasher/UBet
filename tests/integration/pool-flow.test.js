// End-to-end service test over a throwaway SQLite DB: pool lifecycle, scoring,
// real-time state assembly, and the knockout-bracket resolver. Runs without the
// HTTP/socket layer so it stays fast and deterministic.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `ubet-itest-${process.pid}.db`);
process.env.DATABASE_PATH = DB;

let pools;
let fixtures;

before(async () => {
  rmSync(DB, { force: true });
  rmSync(DB + '-wal', { force: true });
  rmSync(DB + '-shm', { force: true });
  fixtures = await import('../../server/fixtures.js');
  await fixtures.initFixtures();
  pools = await import('../../server/pools.js');
});

test('create → join → predict → result → leaderboard + pot', () => {
  const { pool, host } = pools.createPool({
    name: 'Test', buyIn: 10, currency: 'USD', pin: '1234', hostName: 'Host',
    rules: { exact: 5, resultGd: 3, result: 1, knockoutMultiplier: 2 },
  });
  const p2 = pools.addPlayer({ poolId: pool.id, displayName: 'Bob' });

  // both predict match #1 (a group game); host nails it, Bob gets result only
  pools.submitPrediction({ poolId: pool.id, playerId: host.id, num: 1, home: 2, away: 1, force: true });
  pools.submitPrediction({ poolId: pool.id, playerId: p2.id, num: 1, home: 3, away: 0, force: true });

  pools.enterResult({ poolId: pool.id, num: 1, homeScore: 2, awayScore: 1 });

  const state = pools.buildState(pool.id, host.id);
  const hostRow = state.leaderboard.find((r) => r.playerId === host.id);
  const bobRow = state.leaderboard.find((r) => r.playerId === p2.id);
  assert.equal(hostRow.points, 5, 'exact = 5');
  assert.equal(bobRow.points, 1, 'correct result only = 1');
  assert.equal(state.leaderboard[0].playerId, host.id, 'host leads');

  // pot = 2 players * 10
  assert.equal(state.pot.total, 20);
  pools.setPlayerPaid(pool.id, host.id, true);
  assert.equal(pools.buildState(pool.id).pot.paidTotal, 10);
});

test('knockout bracket resolves after all group games are final', () => {
  const { pool } = pools.createPool({
    name: 'Bracket', buyIn: 0, currency: 'USD', pin: '1234', hostName: 'H',
  });

  // rank within each group by appearance order (earlier = stronger)
  const rankInGroup = new Map();
  for (const g of new Set(fixtures.getFixtures().teams.map((t) => t.group))) {
    fixtures.getFixtures().teams.filter((t) => t.group === g).forEach((t, i) => rankInGroup.set(t.code, i));
  }

  // stronger team wins 2–0 every group game → deterministic 1st/2nd/3rd/4th
  const groupMatches = fixtures.getFixtures().matches.filter((m) => m.stage === 'group');
  for (const m of groupMatches) {
    const homeStronger = rankInGroup.get(m.home) < rankInGroup.get(m.away);
    pools.enterResult({
      poolId: pool.id, num: m.id,
      homeScore: homeStronger ? 2 : 0,
      awayScore: homeStronger ? 0 : 2,
    });
  }

  const state = pools.buildState(pool.id);
  const r32 = state.matches.filter((m) => m.stage === 'R32');
  assert.equal(r32.length, 16);
  for (const m of r32) {
    assert.ok(m.home && m.away, `R32 match ${m.num} should have both teams resolved`);
  }

  // exactly 32 distinct teams reach the R32
  const teamsInR32 = new Set(r32.flatMap((m) => [m.home, m.away]));
  assert.equal(teamsInR32.size, 32);

  // advancing an R32 winner fills the next R16 slot
  const first = r32[0];
  pools.enterResult({ poolId: pool.id, num: first.num, homeScore: 3, awayScore: 0 });
  const after = pools.buildState(pool.id);
  const r16 = after.matches.filter((m) => m.stage === 'R16');
  const fed = r16.some((m) => m.home === first.home || m.away === first.home);
  assert.ok(fed, 'R32 winner should advance into an R16 fixture');
});

test('drawn knockout match requires a penalty winner', () => {
  const { pool } = pools.createPool({ name: 'KO', buyIn: 0, currency: 'USD', pin: '1', hostName: 'H' });
  // resolve groups quickly so an R32 fixture has teams
  for (const m of fixtures.getFixtures().matches.filter((x) => x.stage === 'group')) {
    pools.enterResult({ poolId: pool.id, num: m.id, homeScore: 1, awayScore: 0 });
  }
  const r32 = pools.buildState(pool.id).matches.find((m) => m.stage === 'R32');
  assert.throws(
    () => pools.enterResult({ poolId: pool.id, num: r32.num, homeScore: 1, awayScore: 1 }),
    /penalty/i,
  );
  // with a valid pen winner it succeeds and advances that team
  pools.enterResult({ poolId: pool.id, num: r32.num, homeScore: 1, awayScore: 1, penWinner: r32.home });
  const updated = pools.buildState(pool.id).matches.find((m) => m.num === r32.num);
  assert.equal(updated.status, 'final');
  assert.equal(updated.penWinner, r32.home);
});
