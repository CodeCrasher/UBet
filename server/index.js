import express from 'express';
import compression from 'compression';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { initFixtures } from './fixtures.js';
import { attachSockets } from './sockets.js';
import { createApiRouter } from './routes.js';
import { pushPoolUpdate, room } from './realtime.js';
import { startSync } from './sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

await initFixtures();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((s) => s.trim()) },
});

app.use(compression());
app.use(express.json({ limit: '256kb' }));

app.use('/api', createApiRouter(io));
attachSockets(io);
startSync(io);

// Serve the built SPA in production; in dev the Vite server handles the client.
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(join(DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.status(200).send('UBet API is running. Run `npm run dev` for the client, or `npm run build` then `npm start`.'),
  );
}

// Lightweight ticker: every 30s, re-push state to active pool rooms so that
// matches crossing their kickoff time lock for everyone without a refresh.
const TICK_MS = 30_000;
setInterval(() => {
  const rooms = io.sockets.adapter.rooms;
  const seen = new Set();
  for (const [name] of rooms) {
    if (!name.startsWith('pool:')) continue;
    const poolId = name.slice('pool:'.length);
    if (seen.has(poolId)) continue;
    seen.add(poolId);
    pushPoolUpdate(io, poolId);
  }
}, TICK_MS).unref();

server.listen(PORT, () => {
  console.log(`⚽ UBet listening on http://localhost:${PORT}`);
  if (!existsSync(DIST)) console.log('   (client not built — run `npm run dev` or `npm run build`)');
});

export { app, server, io, room };
