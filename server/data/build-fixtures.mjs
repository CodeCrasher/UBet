#!/usr/bin/env node
// Builds the committed WC 2026 fixtures snapshot: 48 teams, 12 groups,
// 72 group matches + 32 knockout matches = 104 total, with a fully
// resolvable bracket.
//
// Schedule source: the open WC2026 community API (https://worldcup26.ir/get).
// Real kickoff times (converted to UTC) and venues are pulled from the API and
// overlaid onto a deterministic, locally-generated base. The base is the source
// of truth for the bracket structure (ids, stages, knockout source tokens) and
// the FIFA group draw; the API supplies only `kickoff` + `venue`.
//
// If the API is unreachable, the script falls back to the deterministic base
// (and preserves an already-committed snapshot rather than regressing it), so
// `postinstall` / deploys never fail on a network hiccup.
//
// Run: npm run build:fixtures  (also runs on postinstall)
//
// NOTE: group assignments reflect the official FIFA World Cup 2026 draw
// (December 5, 2025). The 8-best-thirds routing into the Round of 32 is a
// documented simplification (assigned by group letter, not the official lookup
// table). A pool host can edit/lock any fixture manually in the app.

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, 'fixtures.json');

const API_BASE = process.env.FIXTURES_API_URL || 'https://worldcup26.ir/get';

// 48 teams across 12 groups (A–L). { code, name, group, flag }
// Official FIFA World Cup 2026 draw (December 5, 2025). Codes are authoritative
// (they match the FIFA codes returned by the API — verified).
const TEAMS = [
  ['MEX', 'Mexico',              'A', '🇲🇽'], ['RSA', 'South Africa',       'A', '🇿🇦'], ['KOR', 'South Korea',        'A', '🇰🇷'], ['CZE', 'Czech Republic',     'A', '🇨🇿'],
  ['CAN', 'Canada',              'B', '🇨🇦'], ['BIH', 'Bosnia & Herzegovina','B', '🇧🇦'], ['QAT', 'Qatar',              'B', '🇶🇦'], ['SUI', 'Switzerland',        'B', '🇨🇭'],
  ['BRA', 'Brazil',              'C', '🇧🇷'], ['MAR', 'Morocco',             'C', '🇲🇦'], ['HAI', 'Haiti',              'C', '🇭🇹'], ['SCO', 'Scotland',           'C', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
  ['USA', 'United States',       'D', '🇺🇸'], ['PAR', 'Paraguay',            'D', '🇵🇾'], ['AUS', 'Australia',          'D', '🇦🇺'], ['TUR', 'Turkey',             'D', '🇹🇷'],
  ['GER', 'Germany',             'E', '🇩🇪'], ['CUW', 'Curaçao',            'E', '🇨🇼'], ['CIV', 'Ivory Coast',        'E', '🇨🇮'], ['ECU', 'Ecuador',            'E', '🇪🇨'],
  ['NED', 'Netherlands',         'F', '🇳🇱'], ['JPN', 'Japan',               'F', '🇯🇵'], ['SWE', 'Sweden',             'F', '🇸🇪'], ['TUN', 'Tunisia',            'F', '🇹🇳'],
  ['BEL', 'Belgium',             'G', '🇧🇪'], ['EGY', 'Egypt',               'G', '🇪🇬'], ['IRN', 'Iran',               'G', '🇮🇷'], ['NZL', 'New Zealand',        'G', '🇳🇿'],
  ['ESP', 'Spain',               'H', '🇪🇸'], ['CPV', 'Cape Verde',          'H', '🇨🇻'], ['KSA', 'Saudi Arabia',       'H', '🇸🇦'], ['URU', 'Uruguay',            'H', '🇺🇾'],
  ['FRA', 'France',              'I', '🇫🇷'], ['SEN', 'Senegal',             'I', '🇸🇳'], ['IRQ', 'Iraq',               'I', '🇮🇶'], ['NOR', 'Norway',             'I', '🇳🇴'],
  ['ARG', 'Argentina',           'J', '🇦🇷'], ['ALG', 'Algeria',             'J', '🇩🇿'], ['AUT', 'Austria',            'J', '🇦🇹'], ['JOR', 'Jordan',             'J', '🇯🇴'],
  ['POR', 'Portugal',            'K', '🇵🇹'], ['COD', 'DR Congo',            'K', '🇨🇩'], ['UZB', 'Uzbekistan',         'K', '🇺🇿'], ['COL', 'Colombia',           'K', '🇨🇴'],
  ['ENG', 'England',             'L', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'], ['CRO', 'Croatia',             'L', '🇭🇷'], ['GHA', 'Ghana',              'L', '🇬🇭'], ['PAN', 'Panama',             'L', '🇵🇦'],
].map(([code, name, group, flag]) => ({ code, name, group, flag }));

const GROUPS = [...new Set(TEAMS.map((t) => t.group))]; // A..L

// Circle-method round robin for 4 teams → 3 matchdays of 2 matches.
const RR_ROUNDS = [
  [[0, 1], [2, 3]],
  [[0, 2], [3, 1]],
  [[3, 0], [1, 2]],
];

function iso(year, month, day, hour) {
  // month is 1-based here for readability
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  return `${year}-${mm}-${dd}T${hh}:00:00.000Z`;
}

// ── Deterministic base: 104 matches, fully-resolvable bracket ──
// Produces fallback kickoffs (overwritten by real API kickoffs when available)
// and `venue: null` (filled from the API). Same input → same output.
function buildBase() {
  const matches = [];
  let id = 1;

  // ── Group stage: 72 matches ──
  // Matchday date windows (June 2026). Each MD spreads the 12 groups across days.
  const MD_DATES = [
    [11, 12, 13, 14], // MD1
    [17, 18, 19, 20], // MD2
    [24, 25, 26, 27], // MD3
  ];
  const KICK_HOURS = [16, 19, 22];

  GROUPS.forEach((g, gi) => {
    const teams = TEAMS.filter((t) => t.group === g);
    RR_ROUNDS.forEach((round, md) => {
      const dates = MD_DATES[md];
      const day = dates[Math.floor(gi / 3) % dates.length];
      round.forEach(([h, a], mi) => {
        matches.push({
          id: id++,
          stage: 'group',
          round: `Group ${g}`,
          group: g,
          matchday: md + 1,
          home: teams[h].code,
          away: teams[a].code,
          homeSource: null,
          awaySource: null,
          kickoff: iso(2026, 6, day, KICK_HOURS[(gi % 3) + mi] ?? KICK_HOURS[mi]),
          venue: null,
        });
      });
    });
  });

  // ── Knockout bracket: 32 matches ──
  // R32 source tokens: 1X = winner group X, 2X = runner-up X, 3-n = nth best third.
  const R32_PAIRS = [
    ['1A', '2B'], ['1C', '2D'], ['1E', '2F'], ['1G', '2H'],
    ['1I', '2J'], ['1K', '2L'], ['1B', '3-1'], ['1D', '3-2'],
    ['1F', '3-3'], ['1H', '3-4'], ['1J', '3-5'], ['1L', '3-6'],
    ['2A', '3-7'], ['2C', '3-8'], ['2E', '2G'], ['2I', '2K'],
  ];

  const R32_START_ID = 73; // ids 73..88
  R32_PAIRS.forEach(([homeSource, awaySource], i) => {
    matches.push({
      id: R32_START_ID + i,
      stage: 'R32',
      round: 'Round of 32',
      group: null,
      matchday: null,
      home: null,
      away: null,
      homeSource,
      awaySource,
      kickoff: iso(2026, 6, 28 + Math.floor(i / 4), KICK_HOURS[i % 3]),
      venue: null,
    });
  });

  // Helper: build a round from pairs of previous-round match ids.
  function buildRound({ stage, round, startId, sourceIds, day, special }) {
    for (let i = 0; i < sourceIds.length; i += 2) {
      matches.push({
        id: startId + i / 2,
        stage,
        round,
        group: null,
        matchday: null,
        home: null,
        away: null,
        homeSource: special === 'third' ? `LM:${sourceIds[i]}` : `WM:${sourceIds[i]}`,
        awaySource: special === 'third' ? `LM:${sourceIds[i + 1]}` : `WM:${sourceIds[i + 1]}`,
        kickoff: iso(2026, 7, day, KICK_HOURS[(i / 2) % 3]),
        venue: null,
      });
    }
  }

  const r32Ids = matches.filter((m) => m.stage === 'R32').map((m) => m.id); // 73..88
  buildRound({ stage: 'R16', round: 'Round of 16', startId: 89, sourceIds: r32Ids, day: 3 });

  const r16Ids = matches.filter((m) => m.stage === 'R16').map((m) => m.id); // 89..96
  buildRound({ stage: 'QF', round: 'Quarter-finals', startId: 97, sourceIds: r16Ids, day: 9 });

  const qfIds = matches.filter((m) => m.stage === 'QF').map((m) => m.id); // 97..100
  buildRound({ stage: 'SF', round: 'Semi-finals', startId: 101, sourceIds: qfIds, day: 14 });

  const sfIds = matches.filter((m) => m.stage === 'SF').map((m) => m.id); // 101..102

  // Third-place playoff: losers of the two semis.
  matches.push({
    id: 103, stage: 'TP', round: 'Third-place playoff', group: null, matchday: null,
    home: null, away: null, homeSource: `LM:${sfIds[0]}`, awaySource: `LM:${sfIds[1]}`,
    kickoff: iso(2026, 7, 18, 16), venue: null,
  });

  // Final: winners of the two semis.
  matches.push({
    id: 104, stage: 'F', round: 'Final', group: null, matchday: null,
    home: null, away: null, homeSource: `WM:${sfIds[0]}`, awaySource: `WM:${sfIds[1]}`,
    kickoff: iso(2026, 7, 19, 19), venue: null,
  });

  return matches;
}

// ── API enrichment ──

async function fetchJson(path, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${API_BASE}/${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for /${path}`);
    const body = await res.json();
    const arr = body?.[path] ?? body; // unwrap { games: [...] } / { teams: [...] } / { stadiums: [...] }
    if (!Array.isArray(arr)) throw new Error(`Unexpected shape for /${path}`);
    return arr;
  } finally {
    clearTimeout(timer);
  }
}

// UTC offset (hours) for a host venue during the tournament window
// (Jun 11 – Jul 19, 2026). US & Canada observe DST in that window; Mexico does
// not observe DST. Derived from the stadium's country + region — not hardcoded
// per fixture. All 16 WC2026 venues are covered by these cases.
function offsetHoursForStadium(s) {
  if (!s) return 0;
  if (s.country_en === 'Mexico') return -6;        // CST, no DST (Mexico City / Guadalajara / Monterrey)
  switch (s.region) {
    case 'Eastern': return -4;                      // EDT (incl. Toronto)
    case 'Central': return -5;                      // CDT
    case 'Western': return -7;                      // PDT / Pacific (incl. Vancouver, Seattle, SF, LA)
    default: return 0;                              // safe fallback: treat as UTC
  }
}

// "MM/DD/YYYY HH:MM" (venue-local) + offset → UTC ISO instant.
function toUtcIso(localDate, offsetHours) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(String(localDate).trim());
  if (!m) return null;
  const [mm, dd, yyyy, hh, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  // UTC instant = local time minus the venue's offset. Date.UTC normalizes any
  // day rollover (e.g. a late kickoff at a negative offset crossing midnight).
  const ms = Date.UTC(yyyy, mm - 1, dd, hh - offsetHours, mi);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// Overlay real kickoffs + venues onto the base. Mutates `matches` in place.
// Returns the number of matches enriched. Throws if the API is unreachable.
async function enrich(matches) {
  const [games, apiTeams, stadiums] = await Promise.all([
    fetchJson('games'),
    fetchJson('teams'),
    fetchJson('stadiums'),
  ]);

  const codeById = new Map(apiTeams.map((t) => [String(t.id), t.fifa_code]));
  const stadiumById = new Map(stadiums.map((s) => [String(s.id), s]));

  // Group matches join by team-pair (the API's match ids are date-ordered and
  // do NOT match our group-ordered ids — verified). Knockouts join by id
  // (verified 32/32 aligned).
  const pairKey = (a, b) => [a, b].sort().join('|');
  const apiByPair = new Map();
  const apiById = new Map();
  for (const g of games) {
    apiById.set(String(g.id), g);
    if (g.type === 'group') {
      const h = codeById.get(String(g.home_team_id));
      const a = codeById.get(String(g.away_team_id));
      if (h && a) apiByPair.set(pairKey(h, a), g);
    }
  }

  let enriched = 0;
  for (const m of matches) {
    const g = m.stage === 'group'
      ? apiByPair.get(pairKey(m.home, m.away))
      : apiById.get(String(m.id));
    if (!g) continue;

    const stadium = stadiumById.get(String(g.stadium_id));
    const kickoff = toUtcIso(g.local_date, offsetHoursForStadium(stadium));
    if (kickoff) m.kickoff = kickoff;
    if (stadium) m.venue = stadium.name_en;

    // Knockout slots are TBD until the bracket resolves. Only adopt real team
    // codes when the API has them (home/away team_id "0" → no mapping → kept
    // null so the bracket resolver fills them). Group teams stay authoritative.
    if (m.stage !== 'group') {
      const h = codeById.get(String(g.home_team_id));
      const a = codeById.get(String(g.away_team_id));
      if (h) m.home = h;
      if (a) m.away = a;
    }
    enriched += 1;
  }
  return enriched;
}

// ── main ──
const matches = buildBase();
let note = 'Group draw per the official FIFA World Cup 2026 draw (Dec 5, 2025). Hosts can edit/lock any fixture in-app.';
let enrichedCount = 0;
let usedApi = false;

try {
  enrichedCount = await enrich(matches);
  usedApi = true;
  note = `Live schedule (kickoffs + venues) from ${API_BASE}; group draw per FIFA (Dec 5, 2025). Hosts can edit/lock any fixture in-app.`;
  console.log(`✓ Enriched ${enrichedCount}/${matches.length} fixtures with real kickoffs + venues from ${API_BASE}`);
} catch (err) {
  console.warn(`⚠ API fetch failed (${err.message}), using generated fixtures`);
  // Never regress an already-committed real snapshot to the algorithmic
  // fallback just because the network blinked during a deploy.
  if (existsSync(outPath)) {
    console.warn('  → preserving existing committed fixtures.json (not overwriting with generated fallback)');
    runSanityChecks(matches);
    process.exit(0);
  }
}

function runSanityChecks(ms) {
  const groupCount = ms.filter((m) => m.stage === 'group').length;
  const koCount = ms.filter((m) => m.stage !== 'group').length;
  if (TEAMS.length !== 48) throw new Error(`Expected 48 teams, got ${TEAMS.length}`);
  if (groupCount !== 72) throw new Error(`Expected 72 group matches, got ${groupCount}`);
  if (koCount !== 32) throw new Error(`Expected 32 knockout matches, got ${koCount}`);
  if (ms.length !== 104) throw new Error(`Expected 104 matches, got ${ms.length}`);
}

runSanityChecks(matches);

const out = {
  tournament: 'FIFA World Cup 2026',
  hosts: ['USA', 'CAN', 'MEX'],
  generatedBy: 'build-fixtures.mjs',
  source: usedApi ? API_BASE : 'generated (API unavailable)',
  note,
  teams: TEAMS,
  matches,
};

writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`✓ Wrote ${matches.length} matches (${TEAMS.length} teams) → ${outPath}`);
