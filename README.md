# ⚽ UBet — live World Cup 2026 prediction board

A Dream11-style, **pari-mutuel** prediction game for the FIFA World Cup 2026. Log in,
browse fixtures, enter pre-made pools, place a pick, and watch a live **tote board** track
who'd win if the match ended right now — then settle for real when the result is confirmed.

**No real money — ever.** Entry fees and winnings are virtual balances in Rs; nothing is
ever charged. The server is the single source of truth for balances, pools, standings, and
settlement.

<p align="center">
  <strong>▶ Live:</strong> <a href="https://ubet-production.up.railway.app">ubet-production.up.railway.app</a>
  &nbsp;·&nbsp; <strong>Source:</strong> <a href="https://github.com/CodeCrasher/UBet">github.com/CodeCrasher/UBet</a>
</p>

---

## What it does

- **Log in once, stay logged in.** Email + password with an httpOnly session cookie that
  survives refreshes and restarts. (Chosen over OAuth as the lightest, dependency-free,
  self-contained option — no provider keys to manage. The session model is a server-side
  token table, so it's trivial to add OAuth later.)
- **Fixtures home.** Every WC 2026 match as a card (kickoff, teams, UPCOMING / LIVE / FINAL).
- **Five pre-made pools per fixture.** Users **never create pools** — they're all seeded.
- **Per-pool leaderboards** that update live over Socket.io.
- **The Tote Board.** A stadium betting-board hero: a split-flap pot counter and a live
  per-pool standing where rows slide and the new leader's badge flips to **CURRENTLY WINNING**.
- **Total earnings + drill-down.** A balance chip shows running earnings (virtual); tapping it
  opens an itemised, reconciling breakdown per fixture/pool.
- **PIN-gated admin** to push live scores, confirm results, and trigger settlement.

---

## The five pools (per fixture)

Defined data-first in [`server/data/pool-types.json`](server/data/pool-types.json) — change
fees/mechanics without touching code.

| # | Pool | Predict | Entry |
|---|------|---------|-------|
| 1 | Winner Pool · Big | Match winner (Home/Draw/Away) | Rs 1000 |
| 2 | Exact Score Pool | Exact final scoreline | Rs 500 |
| 3 | Winner Pool · Small | Match winner | Rs 500 |
| 4 | Total Goals Pool | Exact total combined goals | Rs 500 |
| 5 | Margin Pool | Winner **and** exact winning margin (draw = 0) | Rs 750 |

All entries **lock at kickoff** — no joining or editing once the match starts. Knockout
winner picks have no Draw (winner includes extra time and penalties).

### Correctness & the knockout scoreline rule

A pick is **correct** when: winner pools — the pick equals the result; exact — both goals
match; total — the combined total matches; margin — both winner and exact margin match.

For knockout matches, the **scoreline used for pools 2/4/5 is the end-of-extra-time score,
excluding penalty-shootout goals**. A 1–1 decided on penalties counts as scoreline 1–1
(total 2, margin 0); the winner pools (1/3) and the *winner* half of the margin pool use the
official progressing side, while the margin uses the ET scoreline — so a pen-decided draw
refunds the margin pool (no valid non-draw margin can be 0).

### Settlement (pari-mutuel, deterministic)

- `prizePool = entryFee × entrants` (rake configurable per pool, default 0).
- The pool is **split equally among all correct entrants** — no ranks, no order. Each gets
  `prizePool ÷ correctCount` in whole Rs; any rounding remainder is handed out one Rs at a
  time to correct entrants in **entry-timestamp order**, so the books stay exact.
- **Zero correct → everyone is refunded** their entry (common for pools 2/4/5 — by design).
- **One correct → takes the whole pot.**
- Settlement runs once when the admin confirms the result and is **idempotent** — re-running
  changes nothing.

The same `settlePool` / `isCorrect` functions ([`server/settle.js`](server/settle.js)) power
both the **live provisional standing** and the **final settlement**, fed by either the live
score or the confirmed score — so "currently winning" and "actually paid" never drift.

### Live provisional standing

While a match is live, each pool's board treats the current score as if final: correct
entrants share the projected pot and show **CURRENTLY WINNING**; the rest are ranked by
closeness (display only — payout stays binary). If no one is currently correct, the board
says so plainly ("pot would refund at this score"). **No balances move until full time.**

---

## Quick start

Requires **Node 20+**.

```bash
npm install            # also generates server/data/fixtures.json
cp .env.example .env   # optional — all values have defaults

# dev with hot reload (Vite :5173 proxying API/ws to :8080)
npm run dev            # → http://localhost:5173

# production-style single service
npm run build && npm start   # → http://localhost:8080
```

### Spin up a populated demo

```bash
npm run seed
```

Creates demo users (`alice@ubet.test`, `bob@ubet.test`, `carol@ubet.test` — password
`password` for all), seeds every fixture's five pools, and places a few demo entries on the
next open fixture. Log in, open a fixture, enter a pool, then open the **⚙ admin panel**
(PIN `2026` by default) to push live scores and confirm the result.

---

## Configuration (env vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port for the single service. |
| `NODE_ENV` | `development` | `production` → secure cookies + static SPA serving. |
| `DATABASE_PATH` | `./data/ubet.db` | SQLite file. Point at a mounted volume in prod. |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins, or `*`. |
| `STARTING_BALANCE` | `100000` | Virtual Rs granted to each new account. |
| `ADMIN_PIN` | `2026` | Gates the admin panel — **change in production**. |
| `SESSION_TTL_MS` | `2592000000` (30d) | Login-cookie lifetime. |

---

## Real-time events (`namespace:action`, server is authority)

| Direction | Event | Payload |
|-----------|-------|---------|
| client → server | `fixture:subscribe` / `pool:subscribe` | join a fixture/pool room |
| server → client | `match:scoreUpdate` | new live score + status for a fixture |
| server → client | `pool:update` | full pool standing (open / live provisional / settled) |
| server → client | `fixtures:update` | a fixture's status/score changed |
| server → client | `user:earnings` | the viewer's `{ total, balance }` after a settlement |

---

## Tests

```bash
npm run lint          # ESLint
npm test              # unit (settle core) + integration (full domain flow)
npm run test:e2e      # Playwright, desktop + mobile
```

- **Unit** ([`tests/unit/settle.test.js`](tests/unit/settle.test.js)) covers every pool type
  and each settlement edge case — zero-correct refund, one-correct whole-pot, rounding
  remainder by entry time, rake, and deterministic/idempotent re-runs.
- **Integration** ([`tests/integration/flow.test.js`](tests/integration/flow.test.js)) runs
  register → enter → live provisional → confirm → earnings reconcile → idempotent re-settle.
- **E2E** drives the UI: log in → refresh stays logged in → enter a pool → admin pushes a
  live score (the board swings) → admin confirms → board, earnings, and breakdown reconcile.

---

## Deploy to Railway

Deploys as **one service** from the included `Dockerfile`; `railway.json` builds it.

1. Push to GitHub → Railway: **New Project → Deploy from GitHub repo**.
2. Add a **Volume** mounted at `/app/data` so the SQLite DB (users, balances, entries)
   survives redeploys (default `DATABASE_PATH` is `/app/data/ubet.db`).
3. Set `ADMIN_PIN` (and any other env you want). `PORT` is injected by Railway.

Push-to-deploy is wired via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
(needs a `RAILWAY_TOKEN` repo secret). CI ([`ci.yml`](.github/workflows/ci.yml)) runs lint +
build + tests + Playwright on every push.

```bash
docker build -t ubet . && docker run -p 8080:8080 -v ubet-data:/app/data ubet
```

---

## Design — the "live-broadcast betting board"

One opinionated identity: a modern match-graphics package. Light, crisp app (turf green
`--pitch`, hot `--signal` reserved for live/lead-change only), Archivo for scoreboard data +
Hanken Grotesk for UI, tabular figures everywhere money/scores appear. The **Tote Board** is
the hero — a dark stadium board with a split-flap pot counter and a leaderboard that slides
and flips as the lead swings — kept loud while everything around it stays quiet. All motion
honors `prefers-reduced-motion`.

## Non-obvious tradeoffs

- **Auth is email/password, not OAuth** — lightest to implement, no secrets, fully
  self-contained. Sessions are opaque DB-backed tokens in an httpOnly cookie.
- **One global tournament.** Pools are shared by all users (not per-room), which is what
  "pre-made pools, users never create" implies — far simpler than the old clone-per-room model.
- **Live scores are admin-driven** by default (PIN panel). A live data feed could replace the
  admin as the score source; the provisional/settlement logic is feed-agnostic.
- **Seeded draw, not the official one.** The committed bracket is a plausible snapshot; group
  positions resolve the knockout bracket as results are confirmed. Edit
  [`build-fixtures.mjs`](server/data/build-fixtures.mjs) for the real draw.
- **Kickoff locking uses server wall-clock.** The unit/integration tests are clock-independent;
  the E2E enters the next *open* fixture, so it assumes it runs within the tournament window.

---

## License

MIT — virtual money, real fun. 🏆
