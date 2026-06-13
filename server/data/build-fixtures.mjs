#!/usr/bin/env node
// Generates the committed WC 2026 fixtures snapshot: 48 teams, 12 groups,
// 72 group matches + 32 knockout matches = 104 total, with a fully
// resolvable bracket. Deterministic — same input always yields the same
// JSON, so the snapshot is reproducible and reviewable in git.
//
// Run: npm run build:fixtures  (also runs on postinstall)
//
// NOTE: group assignments are a plausible seeded snapshot, not the official
// FIFA draw. The 8-best-thirds routing into the Round of 32 is a documented
// simplification (assigned by group letter, not the official lookup table).
// A pool host can edit/lock any fixture manually in the app. To use the real
// draw, replace this generator's TEAMS table or point FIXTURES_API_URL at a
// live source returning the same JSON shape.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 48 teams across 12 groups (A–L). { code, name, group, flag }
const TEAMS = [
  ['MEX', 'Mexico', 'A', '🇲🇽'], ['CRO', 'Croatia', 'A', '🇭🇷'], ['NGA', 'Nigeria', 'A', '🇳🇬'], ['UZB', 'Uzbekistan', 'A', '🇺🇿'],
  ['CAN', 'Canada', 'B', '🇨🇦'], ['BEL', 'Belgium', 'B', '🇧🇪'], ['EGY', 'Egypt', 'B', '🇪🇬'], ['NZL', 'New Zealand', 'B', '🇳🇿'],
  ['USA', 'United States', 'C', '🇺🇸'], ['SUI', 'Switzerland', 'C', '🇨🇭'], ['GHA', 'Ghana', 'C', '🇬🇭'], ['QAT', 'Qatar', 'C', '🇶🇦'],
  ['ARG', 'Argentina', 'D', '🇦🇷'], ['NOR', 'Norway', 'D', '🇳🇴'], ['CIV', 'Ivory Coast', 'D', '🇨🇮'], ['PAN', 'Panama', 'D', '🇵🇦'],
  ['FRA', 'France', 'E', '🇫🇷'], ['DEN', 'Denmark', 'E', '🇩🇰'], ['SEN', 'Senegal', 'E', '🇸🇳'], ['KSA', 'Saudi Arabia', 'E', '🇸🇦'],
  ['BRA', 'Brazil', 'F', '🇧🇷'], ['AUT', 'Austria', 'F', '🇦🇹'], ['CMR', 'Cameroon', 'F', '🇨🇲'], ['CRC', 'Costa Rica', 'F', '🇨🇷'],
  ['ENG', 'England', 'G', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'], ['SRB', 'Serbia', 'G', '🇷🇸'], ['ALG', 'Algeria', 'G', '🇩🇿'], ['IRQ', 'Iraq', 'G', '🇮🇶'],
  ['ESP', 'Spain', 'H', '🇪🇸'], ['UKR', 'Ukraine', 'H', '🇺🇦'], ['TUN', 'Tunisia', 'H', '🇹🇳'], ['JAM', 'Jamaica', 'H', '🇯🇲'],
  ['POR', 'Portugal', 'I', '🇵🇹'], ['POL', 'Poland', 'I', '🇵🇱'], ['KOR', 'South Korea', 'I', '🇰🇷'], ['BOL', 'Bolivia', 'I', '🇧🇴'],
  ['NED', 'Netherlands', 'J', '🇳🇱'], ['ECU', 'Ecuador', 'J', '🇪🇨'], ['JPN', 'Japan', 'J', '🇯🇵'], ['COD', 'DR Congo', 'J', '🇨🇩'],
  ['GER', 'Germany', 'K', '🇩🇪'], ['COL', 'Colombia', 'K', '🇨🇴'], ['IRN', 'Iran', 'K', '🇮🇷'], ['PAR', 'Paraguay', 'K', '🇵🇾'],
  ['ITA', 'Italy', 'L', '🇮🇹'], ['URU', 'Uruguay', 'L', '🇺🇾'], ['AUS', 'Australia', 'L', '🇦🇺'], ['MAR', 'Morocco', 'L', '🇲🇦'],
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
      });
    });
  });
});

// ── Knockout bracket: 32 matches ──
// R32 source tokens: 1X = winner group X, 2X = runner-up X, 3-n = nth best third.
// All 12 winners, 12 runners-up, 8 thirds used exactly once. No same-group ties.
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
  });
});

// Helper: build a round from pairs of previous-round match ids.
function buildRound({ stage, round, startId, sourceIds, day, special }) {
  for (let i = 0; i < sourceIds.length; i += 2) {
    const m = {
      id: startId + i / 2,
      stage,
      round,
      group: null,
      matchday: null,
      home: null,
      away: null,
      homeSource: special === 'third'
        ? `LM:${sourceIds[i]}`
        : `WM:${sourceIds[i]}`,
      awaySource: special === 'third'
        ? `LM:${sourceIds[i + 1]}`
        : `WM:${sourceIds[i + 1]}`,
      kickoff: iso(2026, 7, day, KICK_HOURS[(i / 2) % 3]),
    };
    matches.push(m);
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
  id: 103,
  stage: 'TP',
  round: 'Third-place playoff',
  group: null,
  matchday: null,
  home: null,
  away: null,
  homeSource: `LM:${sfIds[0]}`,
  awaySource: `LM:${sfIds[1]}`,
  kickoff: iso(2026, 7, 18, 16),
});

// Final: winners of the two semis.
matches.push({
  id: 104,
  stage: 'F',
  round: 'Final',
  group: null,
  matchday: null,
  home: null,
  away: null,
  homeSource: `WM:${sfIds[0]}`,
  awaySource: `WM:${sfIds[1]}`,
  kickoff: iso(2026, 7, 19, 19),
});

const out = {
  tournament: 'FIFA World Cup 2026',
  hosts: ['USA', 'CAN', 'MEX'],
  generatedBy: 'build-fixtures.mjs',
  note: 'Seeded snapshot — group draw is plausible, not official. Hosts can edit/lock any fixture in-app.',
  teams: TEAMS,
  matches,
};

// Sanity checks — fail loudly if the generator drifts.
const groupCount = matches.filter((m) => m.stage === 'group').length;
const koCount = matches.filter((m) => m.stage !== 'group').length;
if (TEAMS.length !== 48) throw new Error(`Expected 48 teams, got ${TEAMS.length}`);
if (groupCount !== 72) throw new Error(`Expected 72 group matches, got ${groupCount}`);
if (koCount !== 32) throw new Error(`Expected 32 knockout matches, got ${koCount}`);
if (matches.length !== 104) throw new Error(`Expected 104 matches, got ${matches.length}`);

const outPath = join(__dirname, 'fixtures.json');
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`✓ Wrote ${matches.length} matches (${TEAMS.length} teams) → ${outPath}`);
