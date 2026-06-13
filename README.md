# ⚽ UBet — World Cup 2026 Prediction Pool

A private, real-time score-prediction pool for the FIFA World Cup 2026. Friends
join with a room code, predict exact scorelines for every match, earn points, and
climb a live leaderboard. Whoever tops the board when the tournament ends takes the
pot. **No real money moves through the app** — buy-ins and payments are tracked, not
charged.

The server is the single source of truth for predictions, scoring, pot value, and
standings. Everything is one deployable Node service: Express + Socket.io API and a
Preact single-page app served from the same process.

<p align="center"><em>Light, airy UI · pitch-green &amp; gold · mobile-first · animated pot counter &amp; live leaderboard.</em></p>

---

## Features

- **Pools / rooms** — a host creates a pool and gets a 6-character room code. Players
  join with the code + a display name. Host actions (entering results, locking
  matches, editing settings, toggling buy-ins) are **PIN-gated**.
- **Matches view** — card-based fixtures grouped by matchday / knockout round, with
  kickoff time, teams, status (upcoming / live / final) and your prediction.
  Predictions lock automatically at kickoff.
- **Predictions** — tap a stepper to set an exact scoreline per match; auto-saved and
  editable until kickoff. After lock you can see everyone else's picks.
- **Scoring** (configurable) — exact scoreline **5**, correct result + goal difference
  **3**, correct result only **1**, wrong **0**, with an optional knockout-round
  multiplier. Recomputed deterministically server-side whenever a result is entered.
- **Leaderboard** — live-ranked by points, tie-broken by exact-score count then
  correct-result count then join order. Animated rank changes (FLIP), sticky on
  desktop.
- **Pot panel (hero)** — animated pot counter = Σ buy-ins, contributor list with
  paid / unpaid toggles (host-managed), collection progress bar, and projected winner.
- **Real-time** — pot value, leaderboard and match status push live to every connected
  client over Socket.io, with the server as the authority.
- **Knockout bracket** — Round of 32 → R16 → QF → SF → 3rd-place → Final, unlocking
  automatically as earlier rounds resolve.

---

## Tech stack

| Layer        | Choice                                                        |
|--------------|---------------------------------------------------------------|
| Backend      | Node 20, Express, Socket.io                                   |
| Persistence  | SQLite via `better-sqlite3` (WAL mode)                        |
| Frontend     | Preact + `@preact/signals`, built with Vite                   |
| Tests        | `node --test` (unit + integration), Playwright (E2E)          |
| Deploy       | Single Docker image, Railway-ready                            |

---

## Quick start (local)

Requires **Node 20+**.

```bash
npm install            # also generates server/data/fixtures.json
cp .env.example .env   # optional — all values have sensible defaults

# Option A: dev with hot-reload (Vite on :5173, API on :8080)
npm run dev            # open http://localhost:5173

# Option B: production-style single service
npm run build          # builds the client into /dist
npm start              # serves API + SPA on http://localhost:8080
```

### Spin up a populated demo pool

```bash
npm run seed
```

This creates a pool with players, predictions and two matchdays of results already
entered, then prints the **room code**, **host PIN**, and player tokens. Open the app,
click *Join a pool*, and enter the printed code. To act as host, click **🔑 Host** and
enter the printed PIN.

---

## Configuration (env vars)

All configuration is via environment variables; every one has a default, so the app
runs with no `.env` at all.

| Variable           | Default            | Description |
|--------------------|--------------------|-------------|
| `PORT`             | `8080`             | HTTP port for the single service. |
| `NODE_ENV`         | `development`      | `production` enables static SPA serving + gzip. |
| `DATABASE_PATH`    | `./data/ubet.db`   | SQLite file location. Point at a mounted volume in prod. |
| `CORS_ORIGIN`      | `*`                | Comma-separated allowed origins, or `*`. |
| `DEFAULT_BUY_IN`   | `20`               | Buy-in pre-filled when a host creates a pool. |
| `DEFAULT_CURRENCY` | `USD`              | Currency pre-filled when a host creates a pool. |
| `FIXTURES_API_URL` | _(empty)_          | Optional: pull fixtures from a URL at boot (see below). |
| `FIXTURES_API_KEY` | _(empty)_          | Optional bearer token for `FIXTURES_API_URL`. |

---

## Tournament data

The 48-team, 12-group, 104-match structure (group stage + full knockout bracket) is
generated deterministically by [`server/data/build-fixtures.mjs`](server/data/build-fixtures.mjs)
and committed as `server/data/fixtures.json`. Each new pool clones this snapshot, so
every host enters results for their own pool independently.

- **Live source (optional):** set `FIXTURES_API_URL` to a JSON endpoint returning the
  same shape as `fixtures.json`. It's fetched once at boot; any failure falls back to
  the committed snapshot, so the app is always offline-safe.
- **Custom fixtures:** edit the `TEAMS` table in `build-fixtures.mjs` and run
  `npm run build:fixtures`, or hand-edit `fixtures.json`.

See **Non-obvious tradeoffs** below for what's a real-tournament approximation.

---

## Real-time event convention

Socket.io events follow a `namespace:action` convention. The server is authoritative —
clients mutate state through the REST API and receive pushes; they never invent state.

| Direction | Event                | Payload |
|-----------|----------------------|---------|
| client → server | `pool:subscribe`    | `{ code, token }` — join a pool's room |
| server → client | `pool:state`        | full viewer-specific snapshot (incl. your predictions) |
| server → client | `pool:sync`         | full shared snapshot after any change |
| server → client | `leaderboard:update`| ranked players |
| server → client | `pot:update`        | pot value + contributors |
| server → client | `players:update`    | roster |
| server → client | `match:update`      | a single changed fixture |
| server → client | `pool:error`        | `{ message }` |

---

## Project structure

```
server/
  index.js          Express + Socket.io entry; static SPA serving; kickoff ticker
  db.js             SQLite schema + connection (WAL)
  scoring.js        Pure, unit-tested scoring + standings + bracket helpers
  pools.js          Pool service: lifecycle, predictions, results, KO resolution
  routes.js         REST API (player + PIN-gated host endpoints)
  sockets.js        Socket.io subscribe/snapshot
  realtime.js       Authoritative state push helpers
  fixtures.js       Fixture loader (committed snapshot or live API)
  seed.js           Demo-pool generator
  data/
    build-fixtures.mjs   Deterministic fixture generator
    fixtures.json        Committed WC2026 snapshot
client/
  src/
    app.jsx, main.jsx
    lib/ (store.js signals + socket, api.js, helpers.js)
    components/ (Pot, Leaderboard, Matches, Modals, CountUp)
    views/ (Landing, Pool)
    styles.css        Design system
tests/
  unit/             scoring.test.js
  integration/      pool-flow.test.js (DB-backed service + bracket resolver)
  e2e/              smoke.spec.js (Playwright, desktop + mobile)
```

---

## Testing

```bash
npm run lint          # ESLint (server + client)
npm test              # unit + integration (node --test)
npm run test:e2e      # Playwright E2E, desktop + mobile (builds + starts the app)
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint + build + tests
on every push/PR, with Playwright E2E in a separate job.

---

## Deploy to Railway

UBet deploys as **one service** from the included `Dockerfile`.

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**. Railway reads
   [`railway.json`](railway.json) and builds the Dockerfile automatically.
3. **Add a Volume** so data survives redeploys: mount it at `/app/data` (the default
   `DATABASE_PATH` is `/app/data/ubet.db`), or mount anywhere and set `DATABASE_PATH`
   to a file inside it.
4. Set any env vars you want to override (see the table above). None are required.
5. Railway assigns `PORT` automatically; the server honours it.

The same image runs anywhere Docker does:

```bash
docker build -t ubet .
docker run -p 8080:8080 -v ubet-data:/app/data ubet
# open http://localhost:8080
```

> Prefer Nixpacks over the Dockerfile? Railway's Nixpacks will detect the Node app and
> run `npm run build` (via the `build` script) then `npm start`. The Dockerfile is the
> recommended path because it pins the `better-sqlite3` native build.

---

## Non-obvious tradeoffs

These were judgment calls — flagged here rather than blocking:

- **Seeded draw, not the official one.** Group assignments are a plausible snapshot, not
  the official FIFA draw. Replace `TEAMS` in `build-fixtures.mjs` (or use
  `FIXTURES_API_URL`) for the real draw. A host can also edit/lock any fixture in-app.
- **Best-thirds routing is simplified.** The 8 best third-placed teams are picked
  correctly (points → GD → GF), but routed into Round-of-32 slots by group letter
  rather than the official lookup table. The bracket is structurally correct and fully
  resolvable; hosts can override by entering knockout results directly.
- **"Head-to-head" tie-break.** In a prediction pool players don't play each other, so
  a literal H2H tie-break isn't meaningful. Ties are broken by **exact-score count →
  correct-result count → join order**, which rewards prediction accuracy.
- **Auth is lightweight by design.** A private friends-pool, not a bank: players hold an
  opaque token (localStorage); host actions are gated by a per-pool PIN (scrypt-hashed).
  There's no email/password or rate-limiting — add a reverse proxy / auth layer if you
  expose it widely.
- **Per-pool results.** Each pool's host enters results for their own pool, so pools are
  fully self-contained (no global tournament-admin role).
- **Knockout penalty scoreline.** Prediction points score the entered 90/120-minute
  scoreline. For a drawn knockout match the host also records the shoot-out winner,
  which is used only for bracket advancement, not for scoring.
- **Kickoff locking uses server wall-clock.** Fixtures carry real 2026 dates; a match
  locks once its kickoff passes. The unit/integration tests are clock-independent; the
  E2E test predicts an upcoming fixture and therefore assumes it runs within the
  tournament window.

---

## License

MIT — do whatever you like. Have fun, and may the best predictor win. 🏆
