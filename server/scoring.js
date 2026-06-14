// Pure, deterministic scoring + standings logic. No DB, no I/O — every
// function takes plain objects and returns plain values, so it can be unit
// tested in isolation and produces identical output for identical input.
//
// Scoring is ADDITIVE across markets derived from a single predicted scoreline
// (matching the template's rules): a pick can score on result, exact score,
// goal difference and over/under at once. Custom (pool-level) bet points are
// added on top in pools.js.

export const KNOCKOUT_STAGES = ['R32', 'R16', 'QF', 'SF', 'TP', 'F'];

export const DEFAULT_RULES = {
  result: 3, // correct result (W/D/L) — derived from the predicted scoreline
  exact: 5, // exact scoreline
  goalDiff: 2, // correct goal difference (when not exact)
  overUnder: 2, // correct over/under the goals line
  ouLine: 2.5, // the over/under line
  knockoutMultiplier: 1, // multiplies the per-match base for knockout stages
};

export function isKnockout(stage) {
  return KNOCKOUT_STAGES.includes(stage);
}

function sign(n) {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/**
 * Per-market points breakdown for one prediction against a finished match.
 * @returns {{result,exact,goalDiff,overUnder,base,multiplier,total}}
 */
export function scoreBreakdown(pred, match, rules = DEFAULT_RULES) {
  const zero = { result: 0, exact: 0, goalDiff: 0, overUnder: 0, base: 0, multiplier: 1, total: 0 };
  if (!pred || !match || match.status !== 'final') return zero;
  const { home_score: ah, away_score: aa } = match;
  if (ah == null || aa == null) return zero;
  const ph = pred.home_pred;
  const pa = pred.away_pred;
  if (ph == null || pa == null) return zero;

  const exactHit = ph === ah && pa === aa;
  const resultHit = sign(ph - pa) === sign(ah - aa);
  const gdHit = ph - pa === ah - aa;
  const line = rules.ouLine ?? 2.5;
  const ouHit = ph + pa > line === ah + aa > line;

  const result = resultHit ? rules.result : 0;
  const exact = exactHit ? rules.exact : 0;
  const goalDiff = gdHit && !exactHit ? rules.goalDiff : 0;
  const overUnder = ouHit ? rules.overUnder : 0;
  const base = result + exact + goalDiff + overUnder;
  const multiplier = isKnockout(match.stage) ? rules.knockoutMultiplier || 1 : 1;
  return { result, exact, goalDiff, overUnder, base, multiplier, total: base * multiplier };
}

/** Total points a single prediction earns. */
export function scorePrediction(pred, match, rules = DEFAULT_RULES) {
  return scoreBreakdown(pred, match, rules).total;
}

/**
 * Build the ranked leaderboard.
 * @param players      [{ id, display_name, joined_seq }]
 * @param predictions  [{ player_id, match_id, home_pred, away_pred }]
 * @param matches      [{ id, stage, status, home_score, away_score }]
 * @param rules
 * @param extraPoints  optional { playerId: points } added on top (e.g. custom bets)
 */
export function buildLeaderboard(players, predictions, matches, rules = DEFAULT_RULES, extraPoints = {}) {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const stats = new Map(
    players.map((p) => [
      p.id,
      {
        playerId: p.id,
        name: p.display_name,
        joinedSeq: p.joined_seq ?? 0,
        points: 0,
        matchPoints: 0,
        customPoints: extraPoints[p.id] || 0,
        exact: 0,
        correctResults: 0,
        predictions: 0,
      },
    ]),
  );

  for (const pred of predictions) {
    const s = stats.get(pred.player_id);
    if (!s) continue;
    const match = matchById.get(pred.match_id);
    if (!match) continue;
    s.predictions += 1;
    const bd = scoreBreakdown(pred, match, rules);
    s.matchPoints += bd.total;
    if (bd.exact > 0) s.exact += 1;
    if (bd.result > 0) s.correctResults += 1;
  }

  for (const s of stats.values()) s.points = s.matchPoints + s.customPoints;

  const ranked = [...stats.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.exact - a.exact ||
      b.customPoints - a.customPoints ||
      b.correctResults - a.correctResults ||
      a.joinedSeq - b.joinedSeq ||
      a.name.localeCompare(b.name),
  );

  let rank = 0;
  let prevKey = null;
  ranked.forEach((row, i) => {
    const key = `${row.points}|${row.exact}|${row.customPoints}|${row.correctResults}`;
    if (key !== prevKey) rank = i + 1;
    row.rank = rank;
    prevKey = key;
  });

  return ranked;
}

/**
 * Group standings from finished group matches.
 * @returns Map<groupLetter, orderedStandings[]>
 */
export function computeGroupStandings(teams, matches) {
  const byGroup = new Map();
  for (const t of teams) {
    if (!t.group) continue;
    if (!byGroup.has(t.group)) byGroup.set(t.group, new Map());
    byGroup.get(t.group).set(t.code, {
      team: t.code,
      played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0,
    });
  }

  const groupMatches = matches.filter((m) => m.stage === 'group');
  const totalByGroup = new Map();
  const finalByGroup = new Map();
  for (const m of groupMatches) {
    totalByGroup.set(m.group, (totalByGroup.get(m.group) || 0) + 1);
    if (m.status !== 'final' || m.home_score == null || m.away_score == null) continue;
    finalByGroup.set(m.group, (finalByGroup.get(m.group) || 0) + 1);
    const table = byGroup.get(m.group);
    if (!table) continue;
    const home = table.get(m.home);
    const away = table.get(m.away);
    if (!home || !away) continue;
    home.played++; away.played++;
    home.gf += m.home_score; home.ga += m.away_score;
    away.gf += m.away_score; away.ga += m.home_score;
    if (m.home_score > m.away_score) { home.won++; away.lost++; home.points += 3; }
    else if (m.home_score < m.away_score) { away.won++; home.lost++; away.points += 3; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }

  const out = new Map();
  for (const [g, table] of byGroup) {
    const rows = [...table.values()];
    rows.forEach((r) => { r.gd = r.gf - r.ga; });
    rows.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
    const complete = (finalByGroup.get(g) || 0) === (totalByGroup.get(g) || 0) && (totalByGroup.get(g) || 0) > 0;
    rows.forEach((r) => { r.complete = complete; });
    out.set(g, rows);
  }
  return out;
}

/**
 * Pick the 8 best third-placed teams (only once every group is complete).
 * Documented simplification — routed by group letter, not the official table.
 */
export function selectBestThirds(standings) {
  const thirds = [];
  for (const [group, rows] of standings) {
    if (rows.length < 3 || !rows[0].complete) return null;
    thirds.push({ ...rows[2], group });
  }
  if (thirds.length < 12) return null;
  const ranked = [...thirds].sort(
    (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.group.localeCompare(b.group),
  );
  return [...ranked.slice(0, 8)].sort((a, b) => a.group.localeCompare(b.group));
}
