import { userForSession } from './users.js';
import { poolStanding } from './pools.js';
import { poolRoom, fixtureRoom, userRoom } from './realtime.js';

function cookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function attachSockets(io) {
  io.on('connection', (socket) => {
    // Authenticate from the session cookie so user-targeted pushes can reach them.
    const token = cookieValue(socket.handshake.headers.cookie, 'ubet_session');
    const user = userForSession(token);
    if (user) socket.join(userRoom(user.id));

    socket.on('fixture:subscribe', ({ num } = {}) => {
      if (num != null) socket.join(fixtureRoom(Number(num)));
    });
    socket.on('pool:subscribe', ({ poolId } = {}) => {
      if (!poolId) return;
      socket.join(poolRoom(poolId));
      const s = poolStanding(poolId);
      if (s) socket.emit('pool:update', s);
    });
    socket.on('pool:unsubscribe', ({ poolId } = {}) => {
      if (poolId) socket.leave(poolRoom(poolId));
    });
  });
}
