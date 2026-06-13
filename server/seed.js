#!/usr/bin/env node
// Spin up a fully populated demo pool for instant testing:
//   npm run seed
// Creates a pool, adds players, fills predictions, and enters results for the
// first two matchdays so the leaderboard + pot are already alive. Prints the
// room code, host PIN, and player tokens so you can log in as anyone.

import { initFixtures, getFixtures } from './fixtures.js';
import {
  createPool,
  addPlayer,
  submitPrediction,
  enterResult,
  setPlayerPaid,
  buildState,
} from './pools.js';

await initFixtures();

// Deterministic RNG so the demo is reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIN = process.env.SEED_PIN || '2026';

const { pool, host } = createPool({
  name: 'Friends WC 2026 Pool',
  buyIn: 25,
  currency: 'USD',
  rules: { exact: 5, resultGd: 3, result: 1, knockoutMultiplier: 2 },
  pin: PIN,
  hostName: 'Maya',
});

const players = [host];
for (const name of ['Alex', 'Sam', 'Jordan', 'Taylor', 'Priya']) {
  players.push(addPlayer({ poolId: pool.id, displayName: name }));
}

const fixtures = getFixtures();
const groupMatches = fixtures.matches.filter((m) => m.stage === 'group');

// Deterministic "actual" scoreline for a finished match.
function actualFor(num) {
  const rng = mulberry32(num * 1000 + 7);
  return { home: Math.floor(rng() * 4), away: Math.floor(rng() * 3) };
}

// Each player has an accuracy bias → produces a spread on the leaderboard.
const accuracy = [0.55, 0.45, 0.35, 0.3, 0.25, 0.2];

function predictionFor(playerIdx, num) {
  const actual = actualFor(num);
  const rng = mulberry32(num * 131 + playerIdx * 977 + 3);
  if (rng() < accuracy[playerIdx]) return actual; // nail it
  // otherwise perturb
  const jitter = (base) => Math.max(0, base + (rng() < 0.5 ? -1 : 1) * (rng() < 0.5 ? 0 : 1));
  return { home: jitter(actual.home), away: jitter(actual.away) };
}

// MD1 + MD2 will get results entered; everyone predicts MD1–MD3.
const md1and2 = groupMatches.filter((m) => m.matchday <= 2).map((m) => m.id);
const md3 = groupMatches.filter((m) => m.matchday === 3).map((m) => m.id);
const toPredict = [...md1and2, ...md3];

players.forEach((p, pi) => {
  for (const num of toPredict) {
    const { home, away } = predictionFor(pi, num);
    submitPrediction({ poolId: pool.id, playerId: p.id, num, home, away, force: true });
  }
});

// Host enters results for MD1 + MD2.
for (const num of md1and2) {
  const { home, away } = actualFor(num);
  enterResult({ poolId: pool.id, num, homeScore: home, awayScore: away });
}

// Mark a few buy-ins as paid for the pot panel.
setPlayerPaid(pool.id, host.id, true);
setPlayerPaid(pool.id, players[1].id, true);
setPlayerPaid(pool.id, players[2].id, true);

const state = buildState(pool.id, host.id);

console.log('\n────────────────────────────────────────────');
console.log('  ⚽  UBet demo pool ready');
console.log('────────────────────────────────────────────');
console.log(`  Pool name : ${state.pool.name}`);
console.log(`  Room code : ${state.pool.code}`);
console.log(`  Host PIN  : ${PIN}`);
console.log(`  Buy-in    : ${state.pool.currency} ${state.pool.buyIn}`);
console.log(`  Pot       : ${state.pool.currency} ${state.pot.total} (${state.pot.paidTotal} paid)`);
console.log('\n  Players (token — use as x-player-token / socket auth):');
for (const p of players) {
  console.log(`   • ${p.display_name.padEnd(8)} ${p.is_host ? '(host) ' : '       '} ${p.token}`);
}
console.log('\n  Leaderboard:');
state.leaderboard.forEach((row) => {
  console.log(`   ${String(row.rank).padStart(2)}. ${row.name.padEnd(8)} ${row.points} pts  (${row.exact} exact)`);
});
console.log('\n  → Open the app, click "Join a pool", enter the room code above.');
console.log('  → To act as host, use PIN', PIN, '\n');
