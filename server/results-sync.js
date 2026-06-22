// Automated result ownership: poll the open WC2026 API for finished matches and
// confirm their results into UBet (which settles the pari-mutuel pools) — no
// admin entry required. The admin panel still works as a manual override and as
// the source of truth for anything the feed can't express (notably a knockout
// decided on penalties, which the feed doesn't expose).
//
// Scores from the feed are oriented to the feed's own home/away; UBet's
// home/away orientation can differ, so results are mapped by team code, never
// by position. Confirmation is idempotent — already-final fixtures are skipped.

import { allFixtures } from './tournament.js';
import { confirmResult } from './settlement.js';
import { pushFixture, pushFixtureBoards, pushUserEarnings } from './realtime.js';

const API_BASE = process.env.FIXTURES_API_URL || 'https://worldcup26.ir/get';
const KO_STAGES = new Set(['R32', 'R16', 'QF', 'SF', 'TP', 'F']);
const pairKey = (a, b) => [a, b].sort().join('|');

async function fetchJson(path, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${API_BASE}/${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for /${path}`);
    const body = await res.json();
    const arr = body?.[path] ?? body; // unwrap { games: [...] } / { teams: [...] }
    if (!Array.isArray(arr)) throw new Error(`Unexpected shape for /${path}`);
    return arr;
  } finally {
    clearTimeout(timer);
  }
}

// Lookups over the current DB fixtures: group matches by team-pair (the feed's
// ids are date-ordered, not group-ordered), knockouts by num (verified aligned).
function buildIndex(fixtures) {
  const byPair = new Map();
  const byNum = new Map();
  for (const f of fixtures) {
    byNum.set(f.num, f);
    if (f.stage === 'group' && f.home && f.away) byPair.set(pairKey(f.home, f.away), f);
  }
  return { byPair, byNum };
}

// Resolve one finished feed game to a UBet fixture + scores oriented to UBet's
// home/away. Returns { skip: <reason> } when it shouldn't be auto-confirmed.
export function matchGame(game, codeById, index) {
  if (String(game.finished).toUpperCase() !== 'TRUE') return { skip: 'not-finished' };
  const apiHome = codeById.get(String(game.home_team_id));
  const apiAway = codeById.get(String(game.away_team_id));
  const hs = Number(game.home_score);
  const as = Number(game.away_score);
  if (!apiHome || !apiAway || !Number.isInteger(hs) || !Number.isInteger(as)) return { skip: 'incomplete-data' };

  const fixture = game.type === 'group'
    ? index.byPair.get(pairKey(apiHome, apiAway))
    : index.byNum.get(Number(game.id));
  if (!fixture) return { skip: 'no-fixture' };
  if (fixture.status === 'final') return { skip: 'already-final', fixture };
  if (fixture.home == null || fixture.away == null) return { skip: 'teams-unresolved', fixture };

  // Orient by team code, not position.
  let homeScore;
  let awayScore;
  if (fixture.home === apiHome && fixture.away === apiAway) { homeScore = hs; awayScore = as; }
  else if (fixture.home === apiAway && fixture.away === apiHome) { homeScore = as; awayScore = hs; }
  else return { skip: 'team-mismatch', fixture };

  // A level knockout needs a shootout winner the feed doesn't provide → admin.
  if (KO_STAGES.has(fixture.stage) && homeScore === awayScore) return { skip: 'ko-draw-needs-pens', fixture };

  return { fixture, homeScore, awayScore };
}

/** Pull the feed once and confirm every newly-finished result. Returns a summary. */
export async function syncResults(io) {
  const [games, teams] = await Promise.all([fetchJson('games'), fetchJson('teams')]);
  const codeById = new Map(teams.map((t) => [String(t.id), t.fifa_code]));
  const index = buildIndex(allFixtures());

  const confirmed = [];
  const skipped = {};
  for (const game of games) {
    const m = matchGame(game, codeById, index);
    if (m.skip) { skipped[m.skip] = (skipped[m.skip] || 0) + 1; continue; }
    try {
      const { affectedUsers } = confirmResult({
        fixtureNum: m.fixture.num, homeScore: m.homeScore, awayScore: m.awayScore,
      });
      if (io) {
        pushFixture(io, m.fixture.num);
        pushFixtureBoards(io, m.fixture.num);
        for (const uid of affectedUsers) pushUserEarnings(io, uid);
      }
      confirmed.push({ num: m.fixture.num, score: `${m.homeScore}-${m.awayScore}` });
    } catch (err) {
      const key = `error:${err.message}`;
      skipped[key] = (skipped[key] || 0) + 1;
    }
  }
  return { checked: games.length, confirmedCount: confirmed.length, confirmed, skipped };
}

let running = false;
let timer = null;

/**
 * Start the background poller. Runs shortly after boot, then on an interval.
 * Disable with RESULTS_SYNC=off; tune cadence with RESULTS_SYNC_INTERVAL_MS.
 */
export function startResultsSync(io, { intervalMs } = {}) {
  if (String(process.env.RESULTS_SYNC || 'on').toLowerCase() === 'off') {
    console.log('• results-sync disabled (RESULTS_SYNC=off)');
    return () => {};
  }
  const ms = intervalMs || Number(process.env.RESULTS_SYNC_INTERVAL_MS) || 120000;
  const tick = async () => {
    if (running) return; // never overlap a slow poll
    running = true;
    try {
      const r = await syncResults(io);
      if (r.confirmedCount > 0) {
        console.log(`✓ results-sync: confirmed ${r.confirmedCount} result(s) — ${r.confirmed.map((c) => `#${c.num} ${c.score}`).join(', ')}`);
      }
    } catch (err) {
      console.warn(`⚠ results-sync failed (${err.message}) — retrying in ${Math.round(ms / 1000)}s`);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5000).unref?.();
  timer = setInterval(tick, ms);
  timer.unref?.(); // don't keep the event loop alive just for polling
  console.log(`• results-sync started (every ${Math.round(ms / 1000)}s from ${API_BASE})`);
  return () => { if (timer) clearInterval(timer); };
}
