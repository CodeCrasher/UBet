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
    rules: { result: 3, exact: 5, goalDiff: 2, overUnder: 2, knockoutMultiplier: 2 },
  });
  const p2 = pools.addPlayer({ poolId: pool.id, displayName: 'Bob' });

  // both predict match #1 (a group game); host nails it, Bob gets result + o/u
  pools.submitPrediction({ poolId: pool.id, playerId: host.id, num: 1, home: 2, away: 1, force: true });
  pools.submitPrediction({ poolId: pool.id, playerId: p2.id, num: 1, home: 3, away: 0, force: true });

  pools.enterResult({ poolId: pool.id, num: 1, homeScore: 2, awayScore: 1 });

  const state = pools.buildState(pool.id, host.id);
  const hostRow = state.leaderboard.find((r) => r.playerId === host.id);
  const bobRow = state.leaderboard.find((r) => r.playerId === p2.id);
  assert.equal(hostRow.points, 10, 'exact: result 3 + exact 5 + over/under 2 = 10');
  assert.equal(bobRow.points, 5, 'right result + over/under = 5');
  assert.equal(state.leaderboard[0].playerId, host.id, 'host leads');

  // pot = 2 players * 10
  assert.equal(state.pot.total, 20);
  pools.setPlayerPaid(pool.id, host.id, true);
  assert.equal(pools.buildState(pool.id).pot.paidTotal, 10);
});

test('custom bets: answer, settle, and award points', () => {
  const { pool, host } = pools.createPool({ name: 'Props', buyIn: 0, currency: 'USD', pin: '1', hostName: 'H' });
  const bob = pools.addPlayer({ poolId: pool.id, displayName: 'Bob' });

  const bet = pools.createCustomBet({ poolId: pool.id, question: 'Golden Boot?', options: 'Mbappé, Haaland, Messi', points: 7 });
  pools.answerCustomBet({ poolId: pool.id, betId: bet.id, playerId: host.id, answer: 'Haaland' });
  pools.answerCustomBet({ poolId: pool.id, betId: bet.id, playerId: bob.id, answer: 'Messi' });

  // an option that isn't listed is rejected
  assert.throws(() => pools.answerCustomBet({ poolId: pool.id, betId: bet.id, playerId: bob.id, answer: 'Kane' }), /option/i);

  // before settling, nobody has custom points
  let state = pools.buildState(pool.id, host.id);
  assert.equal(state.customBets.length, 1);
  assert.equal(state.customBets[0].status, 'open');
  assert.equal(state.leaderboard.find((r) => r.playerId === host.id).customPoints, 0);

  // host settles → matching answers score
  pools.updateCustomBet({ poolId: pool.id, betId: bet.id, answer: 'Haaland' });
  state = pools.buildState(pool.id, host.id);
  assert.equal(state.customBets[0].status, 'settled');
  assert.equal(state.leaderboard.find((r) => r.playerId === host.id).customPoints, 7);
  assert.equal(state.leaderboard.find((r) => r.playerId === bob.id).customPoints, 0);

  // answering a settled bet is refused
  assert.throws(() => pools.answerCustomBet({ poolId: pool.id, betId: bet.id, playerId: bob.id, answer: 'Haaland' }), /settled/i);
});

test('kicking a player removes them and their picks', () => {
  const { pool, host } = pools.createPool({ name: 'Kick', buyIn: 0, currency: 'USD', pin: '1', hostName: 'H' });
  const bob = pools.addPlayer({ poolId: pool.id, displayName: 'Bob' });
  pools.submitPrediction({ poolId: pool.id, playerId: bob.id, num: 1, home: 1, away: 0, force: true });

  let state = pools.buildState(pool.id);
  assert.ok(state.players.some((p) => p.id === bob.id), 'Bob is in the pool');
  assert.ok((state.revealed[1] || []).some((r) => r.playerId === bob.id), 'Bob has a pick');

  pools.removePlayer(pool.id, bob.id);
  state = pools.buildState(pool.id);
  assert.ok(!state.players.some((p) => p.id === bob.id), 'Bob is gone');
  assert.ok(!(state.revealed[1] || []).some((r) => r.playerId === bob.id), 'his pick is gone too');

  // the host can't be removed
  assert.throws(() => pools.removePlayer(pool.id, host.id), /host/i);
});

test('custom bet closes at its deadline', () => {
  const { pool, host } = pools.createPool({ name: 'DL', buyIn: 0, currency: 'USD', pin: '1', hostName: 'H' });
  const past = new Date(Date.now() - 60_000).toISOString();
  const open = pools.createCustomBet({ poolId: pool.id, question: 'Open one?', options: 'A,B', points: 3 });
  const closed = pools.createCustomBet({ poolId: pool.id, question: 'Closed one?', options: 'A,B', points: 3, locksAt: past });

  pools.answerCustomBet({ poolId: pool.id, betId: open.id, playerId: host.id, answer: 'A' });
  assert.throws(() => pools.answerCustomBet({ poolId: pool.id, betId: closed.id, playerId: host.id, answer: 'A' }), /closed/i);

  const st = pools.buildState(pool.id, host.id);
  assert.equal(st.customBets.find((b) => b.id === closed.id).status, 'locked');
  assert.equal(st.customBets.find((b) => b.id === open.id).status, 'open');
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
