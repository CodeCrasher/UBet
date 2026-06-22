import express from 'express';
import compression from 'compression';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadFixtures, resolveKnockouts } from './tournament.js';
import { seedPools } from './pools.js';
import { attachSockets } from './sockets.js';
import { createApiRouter } from './routes.js';
import { startResultsSync } from './results-sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Boot: load fixtures + pre-seed every fixture's five pools (idempotent).
loadFixtures();
resolveKnockouts();
seedPools();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true },
});

app.use(compression());

// Security headers + CSP tuned for the SPA (same-origin scripts, Google Fonts,
// data: favicon, same-origin websockets).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
});

// Minimal cookie parser (no dependency).
app.use((req, _res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const i = part.indexOf('=');
      if (i > -1) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use('/api', createApiRouter(io));
attachSockets(io);

// Results ownership: auto-confirm finished matches from the live feed (settling
// pools) so the schedule stays current without manual admin entry.
startResultsSync(io);

if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(join(DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.status(200).send('UBet API running. Run `npm run dev` or `npm run build`.'));
}

server.listen(PORT, () => {
  console.log(`⚽ UBet listening on http://localhost:${PORT}`);
  if (!existsSync(DIST)) console.log('   (client not built — run `npm run dev` or `npm run build`)');
});

export { app, server, io };
