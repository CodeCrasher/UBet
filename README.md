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

<p align="center">
  <strong>▶ Live:</strong> <a href="https://ubet-production.up.railway.app">ubet-production.up.railway.app</a>
  &nbsp;·&nbsp; <strong>Source:</strong> <a href="https://github.com/CodeCrasher/UBet">github.com/CodeCrasher/UBet</a>
</p>

---

## Features

- **Pools / rooms** — a host creates a pool and gets a 6-character room code. Players
  join with the code + a display name. Host actions (entering results, locking
  matches, editing settings, toggling buy-ins) are **PIN-gated**.
- **Matches view** — card-based fixtures grouped by matchday / knockout round, with
  kickoff time, teams, status (upcoming / live / final) and your prediction.
  Predictions lock automatically at kickoff.
- **Predictions** — tap a stepper to set an exact scoreline per match; auto-saved and
  editable until kickoff.
- **Scoring** (configurable, **additive markets**) — one scoreline pick scores on every
  market it hits: exact **5**, correct result **3**, goal difference **2**, over/under 2.5
  **2**, with an optional knockout-round multiplier. Each match card shows the per-market
  **points breakdown**. Recomputed deterministically server-side on every result.
- **Custom bets** — the host adds pool-level prop bets (e.g. *Golden Boot?*, *Who lifts
  the trophy?*) with their own options + points, settles the winner, and points flow into
  the leaderboard.
- **Running bets** — every player's picks and custom-bet answers are visible live, per
  match, with points once a game is final.
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
| Deploy       | Single Docker image · live on Railway · GitHub Actions auto-deploy |

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
| `SYNC_PROVIDER`    | _(empty)_          | `thesportsdb` or `footballdata` to pull real fixtures + live results (see below). Empty = committed snapshot + manual results. |
| `FOOTBALL_DATA_API_KEY` | _(empty)_     | Free key from [football-data.org](https://football-data.org) (required for `footballdata`). |
| `SYNC_INTERVAL_MS` | `60000`            | How often to poll the provider for live updates. |
| `SYNC_SEASON`      | `2026`             | Tournament season to sync. |
| `SPORTSDB_KEY`     | `3`                | TheSportsDB key (`3` is the shared free key). |
| `SPORTSDB_LEAGUE`  | `4429`             | TheSportsDB league id (4429 = FIFA World Cup). |
| `FIXTURES_API_URL` | _(empty)_          | Optional: pull a full fixtures snapshot from a URL at boot (lower priority than `SYNC_PROVIDER`). |
| `FIXTURES_API_KEY` | _(empty)_          | Optional bearer token for `FIXTURES_API_URL`. |

---

## Tournament data

The 48-team, 12-group, 104-match structure (group stage + full knockout bracket) is
generated deterministically by [`server/data/build-fixtures.mjs`](server/data/build-fixtures.mjs)
and committed as `server/data/fixtures.json`. By default each new pool clones this
snapshot and the host enters results manually.

### Live sync (real fixtures + results)

Set `SYNC_PROVIDER` to pull **real fixtures and live scores** from a football data API.
The server polls on `SYNC_INTERVAL_MS`, rebuilds a canonical tournament (stable per-pool
match numbers so predictions stay attached), applies results to every synced pool,
recomputes points, and pushes updates over Socket.io. Synced pools don't need a host to
enter results — and match numbers stay stable across syncs.

| Provider | Key? | Notes |
|----------|------|-------|
| `thesportsdb`  | No (free key `3`) | Works out of the box. Coverage depends on what TheSportsDB has loaded for the season — often **partial/provisional** until close to / during the tournament. |
| `footballdata` | Yes (free)        | Most complete + accurate. Register at [football-data.org](https://football-data.org), set `FOOTBALL_DATA_API_KEY`. |

```bash
# Keyless, works immediately (data may be partial right now):
SYNC_PROVIDER=thesportsdb npm start

# Complete + accurate (recommended once you have a free key):
SYNC_PROVIDER=footballdata FOOTBALL_DATA_API_KEY=xxxx npm start
```

> **Why isn't the default draw "correct"?** Until close to / during the tournament, the
> official WC 2026 draw and results aren't fully published in any *free* API. The committed
> snapshot is a complete-but-illustrative bracket so the app is usable offline; turn on a
> provider and it self-corrects to real data (and live results) as the feed fills in.
> Adding a new provider is just another adapter in [`server/providers/`](server/providers/).

- **Custom fixtures (no API):** edit the `TEAMS` table in `build-fixtures.mjs` and run
  `npm run build:fixtures`, or hand-edit `fixtures.json`. A host can also edit/lock any
  fixture in-app on non-synced pools.

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
  fixtures.js       Fixture loader (snapshot / synced canonical / custom URL)
  sync.js           Live-sync orchestrator (provider → canonical → pools → push)
  providers/        Pluggable data adapters
    thesportsdb.mjs      Keyless free provider
    footballdata.mjs     football-data.org provider (free key)
  seed.js           Demo-pool generator
  data/
    build-fixtures.mjs   Deterministic fixture generator
    fixtures.json        Committed WC2026 snapshot
    countries.mjs        Team name → code + flag resolver
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
[`deploy.yml`](.github/workflows/deploy.yml) then ships `main` to Railway (see
**Deploy** below).

---

## Deploy to Railway

UBet deploys as **one service** from the included `Dockerfile`, and is **already live**
at **https://ubet-production.up.railway.app**.

### How the live deployment is wired

| Piece | Setup |
|-------|-------|
| Build | Railway reads [`railway.json`](railway.json) → builds the `Dockerfile` (pins the `better-sqlite3` native build). |
| Persistence | A Railway **Volume** is mounted at `/app/data`; the default `DATABASE_PATH` is `/app/data/ubet.db`, so the SQLite DB survives redeploys. |
| Port | Railway injects `PORT`; the server honours it. |
| Auto-deploy | [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs `railway up` on every push to `main`. |

### Continuous deployment (push → live)

On every push to `main`, GitHub Actions deploys to Railway. This needs **one secret**:

1. Create a Railway token — [Project → Settings → Tokens](https://railway.com/project/fa7262bc-a582-45a0-86ce-6a8a52f5e655/settings/tokens) (project-scoped) or [Account → Tokens](https://railway.com/account/tokens).
2. Add it to the repo:
   ```bash
   gh secret set RAILWAY_TOKEN --repo CodeCrasher/UBet   # paste the token
   ```

After that, `git push` → CI (lint + build + tests) → auto-deploy. (`ci.yml` and `deploy.yml`
run independently, mirroring a typical Railway setup.)

### Deploy your own copy

1. Fork/clone, then in Railway: **New Project → Deploy from GitHub repo** (Railway builds
   the Dockerfile automatically), or from the CLI:
   ```bash
   railway init --name UBet
   railway up
   railway volume add -m /app/data        # persist the SQLite DB
   railway domain                          # get a public URL
   ```
2. Set any env vars you want (see the table above) — e.g. `SYNC_PROVIDER` for live data.
   None are required.

### Run anywhere Docker runs

```bash
docker build -t ubet .
docker run -p 8080:8080 -v ubet-data:/app/data ubet
# open http://localhost:8080
```

> Prefer Nixpacks over the Dockerfile? Railway's Nixpacks will detect the Node app and
> run `npm run build` then `npm start`. The Dockerfile is recommended because it pins the
> `better-sqlite3` native build.

---

## Non-obvious tradeoffs

These were judgment calls — flagged here rather than blocking:

- **Seeded draw by default, not the official one.** The committed bracket is a complete
  but illustrative snapshot — no *free* API has the full, correct WC 2026 draw + results
  until close to / during the tournament. Set `SYNC_PROVIDER` (see **Live sync**) to pull
  real fixtures + live scores; or replace `TEAMS` in `build-fixtures.mjs`; or have a host
  edit/lock fixtures in-app.
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
- **Per-pool results (manual mode).** With no provider configured, each pool's host enters
  results for their own pool, so pools are fully self-contained (no global admin role).
  With `SYNC_PROVIDER` set, synced pools instead auto-score from the live feed.
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
