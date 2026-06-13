import { getPoolByCode, getPlayerByToken, buildState } from './pools.js';
import { room } from './realtime.js';

/**
 * Wire up Socket.io. Clients subscribe with a room code (+ optional player
 * token); we validate, join them to the pool room, and push the full
 * viewer-specific snapshot. All subsequent updates arrive via realtime.js.
 */
export function attachSockets(io) {
  io.on('connection', (socket) => {
    socket.on('pool:subscribe', ({ code, token } = {}) => {
      const pool = getPoolByCode(code);
      if (!pool) {
        socket.emit('pool:error', { message: 'Pool not found' });
        return;
      }
      let viewerId = null;
      if (token) {
        const player = getPlayerByToken(token);
        if (player && player.pool_id === pool.id) viewerId = player.id;
      }
      // leave any previously-joined pool rooms
      for (const r of socket.rooms) {
        if (r.startsWith('pool:')) socket.leave(r);
      }
      socket.join(room(pool.id));
      socket.data.poolId = pool.id;
      socket.emit('pool:state', buildState(pool.id, viewerId));
    });

    socket.on('pool:ping', () => socket.emit('pool:pong', { t: Date.now() }));
  });
}
