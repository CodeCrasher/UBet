import { buildState } from './pools.js';

export const room = (poolId) => `pool:${poolId}`;

/**
 * Recompute the shared pool snapshot and push it to every subscriber.
 * The server is the single source of truth — clients never mutate state
 * locally beyond their own in-flight prediction, which `pool:sync` reconciles.
 *
 * Event convention is `namespace:action`:
 *   pool:sync          full shared snapshot (authoritative)
 *   leaderboard:update ranked players
 *   pot:update         pot value + contributors
 *   players:update     roster
 *   match:update       a single changed fixture (drives status/lock animations)
 */
export function pushPoolUpdate(io, poolId, changedNum = null) {
  const shared = buildState(poolId, null);
  if (!shared) return;
  const r = room(poolId);
  io.to(r).emit('pool:sync', shared);
  io.to(r).emit('leaderboard:update', shared.leaderboard);
  io.to(r).emit('pot:update', shared.pot);
  io.to(r).emit('players:update', shared.players);
  if (changedNum != null) {
    const m = shared.matches.find((x) => x.num === changedNum);
    if (m) io.to(r).emit('match:update', m);
  }
}
