import { poolStanding, poolsForFixture } from './pools.js';
import { getFixture, getLive } from './tournament.js';
import { totalEarnings } from './earnings.js';
import { getUserById } from './users.js';

// Event convention: namespace:action. Server is the single source of truth.
export const poolRoom = (id) => `pool:${id}`;
export const fixtureRoom = (n) => `fixture:${n}`;
export const userRoom = (id) => `user:${id}`;

function liveOf(num) {
  const l = getLive(num);
  return { homeGoals: l.home_goals, awayGoals: l.away_goals, minute: l.minute, phase: l.phase };
}

export function pushPool(io, poolId) {
  const s = poolStanding(poolId);
  if (s) io.to(poolRoom(poolId)).emit('pool:update', s);
}

export function pushFixtureBoards(io, num) {
  for (const p of poolsForFixture(num)) pushPool(io, p.id);
}

// Score change → fixture room gets the score; everyone gets a light list update.
export function pushFixture(io, num) {
  const f = getFixture(num);
  if (!f) return;
  const payload = {
    fixtureNum: num, status: f.status,
    homeScore: f.home_score, awayScore: f.away_score, penWinner: f.pen_winner,
    home: f.home, away: f.away, live: liveOf(num),
  };
  io.to(fixtureRoom(num)).emit('match:scoreUpdate', payload);
  io.emit('fixtures:update', payload);
}

export function pushUserEarnings(io, userId) {
  const u = getUserById(userId);
  io.to(userRoom(userId)).emit('user:earnings', { total: totalEarnings(userId), balance: u?.balance ?? 0 });
}
