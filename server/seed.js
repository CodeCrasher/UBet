#!/usr/bin/env node
// Spin up a populated app for instant testing:
//   npm run seed
// Loads fixtures, seeds the five pools per fixture, creates demo users, and
// places a few demo entries on the next open fixture. Prints logins + admin PIN.

import { loadFixtures, resolveKnockouts, allFixtures, getFixture, isLocked } from './tournament.js';
import { seedPools, poolsForFixture, enterPool } from './pools.js';
import { register, getUserByEmail } from './users.js';
import { teamMap } from './fixtures.js';
import { HOME, AWAY, DRAW } from './settle.js';

loadFixtures();
resolveKnockouts();
seedPools();

const DEMO = [
  { email: 'alice@ubet.test', displayName: 'Alice' },
  { email: 'bob@ubet.test', displayName: 'Bob' },
  { email: 'carol@ubet.test', displayName: 'Carol' },
];
const PASSWORD = 'password';

const users = DEMO.map((d) => {
  const existing = getUserByEmail(d.email);
  if (existing) return existing;
  return register({ email: d.email, password: PASSWORD, displayName: d.displayName });
});

// Find the next open (unlocked) fixture so demo entries can be placed.
const open = allFixtures().find((f) => f.home && f.away && !isLocked(getFixture(f.num)));
const tmap = teamMap();

if (open) {
  const pools = poolsForFixture(open.num);
  const winnerBig = pools.find((p) => p.type === 'WINNER_BIG');
  const exact = pools.find((p) => p.type === 'EXACT');
  const total = pools.find((p) => p.type === 'TOTAL');
  const tryEnter = (poolId, userId, pred) => {
    try { enterPool({ poolId, userId, pred }); } catch { /* already entered / locked */ }
  };
  tryEnter(winnerBig.id, users[0].id, { winner: HOME });
  tryEnter(winnerBig.id, users[1].id, { winner: AWAY });
  tryEnter(winnerBig.id, users[2].id, { winner: DRAW });
  tryEnter(exact.id, users[0].id, { home: 2, away: 1 });
  tryEnter(exact.id, users[1].id, { home: 1, away: 1 });
  tryEnter(total.id, users[2].id, { total: 3 });
}

console.log('\n────────────────────────────────────────────');
console.log('  ⚽  UBet demo ready');
console.log('────────────────────────────────────────────');
console.log('  Demo logins (password for all: "password"):');
for (const u of users) console.log(`   • ${u.email.padEnd(18)} balance Rs ${u.balance}`);
console.log(`\n  Admin PIN: ${process.env.ADMIN_PIN || '2026'} (open the ⚙ Admin panel)`);
if (open) {
  console.log(`\n  Demo entries placed on fixture #${open.num}: ${tmap.get(open.home)?.name} v ${tmap.get(open.away)?.name}`);
  console.log('  → log in, open that fixture, enter a pool, then use Admin to push live scores + confirm the result.');
} else {
  console.log('\n  (No open fixtures right now — every fixture has kicked off. Use Admin to drive scores.)');
}
console.log('');
