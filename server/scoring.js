// Pure, deterministic scoring + standings logic. No DB, no I/O — every
// function takes plain objects and returns plain values, so it can be unit
// tested in isolation and produces identical output for identical input.

export const KNOCKOUT_STAGES = ['R32', 'R16', 'QF', 'SF', 'TP', 'F'];

export const DEFAULT_RULES = {
  exact: 5, // exact scoreline
  resultGd: 3, // correct result AND goal difference (but not exact)
  result: 1, // correct result only (W/D/L)
  knockoutMultiplier: 1, // multiplies base points for knockout matches
};

export function isKnockout(stage) {
  return KNOCKOUT_STAGES.includes(stage);
}

function sign(n) {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/**
 * Points a single prediction earns against a finished match.
 * @param {{home_pred:number, away_pred:number}|null} pred
 * @param {{stage:string, status:string, home_score:number, away_score:number}} match
 * @param {object} rules
 * @returns {number}
 */
export function scorePrediction(pred, match, rules = DEFAULT_RULES) {
  if (!pred || !match || match.status !== 'final') return 0;
  const { home_score: ah, away_score: aa } = match;
  if (ah == null || aa == null) return 0;
  const ph = pred.home_pred;
  const pa = pred.away_pred;
  if (ph == null || pa == null) return 0;

  const exact = ph === ah && pa === aa;
  const predDiff = ph - pa;
  const actDiff = ah - aa;
  const sameResult = sign(predDiff) === sign(actDiff);
  const sameDiff = predDiff === actDiff;

  let base = 0;
  if (exact) base = rules.exact;
  else if (sameResult && sameDiff) base = rules.resultGd;
  else if (sameResult) base = rules.result;

  const mult = isKnockout(match.stage) ? rules.knockoutMultiplier || 1 : 1;
  return base * mult;
}

/**
 * Classify a prediction for stats/tiebreakers: 'exact' | 'resultGd' |
 * 'result' | 'miss' | null (not scorable yet).
 */
export function classifyPrediction(pred, match) {
  if (!pred || !match || match.status !== 'final') return null;
  const { home_score: ah, away_score: aa } = match;
  if (ah == null || aa == null || pred.home_pred == null || pred.away_pred == null) return null;
  const exact = pred.home_pred === ah && pred.away_pred === aa;
  if (exact) return 'exact';
  const predDiff = pred.home_pred - pred.away_pred;
  const actDiff = ah - aa;
  if (sign(predDiff) === sign(actDiff)) {
    return predDiff === actDiff ? 'resultGd' : 'result';
  }
  return 'miss';
}

/**
 * Build the ranked leaderboard.
 * @param players  [{ id, display_name, joined_seq }]
 * @param predictions  [{ player_id, match_id, home_pred, away_pred }]
 * @param matches  [{ id, stage, status, home_score, away_score }]
 * @param rules
 * @returns ranked array: [{ playerId, name, points, exact, correctResults, predictions, rank }]
 */
export function buildLeaderboard(players, predictions, matches, rules = DEFAULT_RULES) {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const stats = new Map(
    players.map((p) => [
      p.id,
      {
        playerId: p.id,
        name: p.display_name,
        joinedSeq: p.joined_seq ?? 0,
        points: 0,
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
    s.points += scorePrediction(pred, match, rules);
    const cls = classifyPrediction(pred, match);
    if (cls === 'exact') s.exact += 1;
    if (cls === 'exact' || cls === 'resultGd' || cls === 'result') s.correctResults += 1;
  }

  const ranked = [...stats.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.exact - a.exact ||
      b.correctResults - a.correctResults ||
      a.joinedSeq - b.joinedSeq ||
      a.name.localeCompare(b.name),
  );

  // Dense-ish ranking: equal stat lines share a rank.
  let rank = 0;
  let prevKey = null;
  ranked.forEach((row, i) => {
    const key = `${row.points}|${row.exact}|${row.correctResults}`;
    if (key !== prevKey) rank = i + 1;
    row.rank = rank;
    prevKey = key;
  });

  return ranked;
}

/**
 * Group standings from finished group matches.
 * @param teams  [{ code, group }]
 * @param matches  group-stage matches with results
 * @returns Map<groupLetter, orderedStandings[]>
 *          each row: { team, played, won, drawn, lost, gf, ga, gd, points, complete }
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
    rows.sort(
      (a, b) =>
        b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team),
    );
    const complete = (finalByGroup.get(g) || 0) === (totalByGroup.get(g) || 0) && (totalByGroup.get(g) || 0) > 0;
    rows.forEach((r) => { r.complete = complete; });
    out.set(g, rows);
  }
  return out;
}

/**
 * Pick the 8 best third-placed teams (only once every group is complete).
 * Returns ordered-by-group-letter codes, or null if not all groups finished.
 * NOTE: this is the documented simplification — the official tournament uses a
 * fixed lookup table to route thirds into specific R32 slots.
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
  const qualified = ranked.slice(0, 8);
  // Assign to slots 3-1..3-8 ordered by group letter (deterministic).
  return [...qualified].sort((a, b) => a.group.localeCompare(b.group));
}
