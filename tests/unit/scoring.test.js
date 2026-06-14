import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scorePrediction,
  scoreBreakdown,
  buildLeaderboard,
  computeGroupStandings,
  selectBestThirds,
  DEFAULT_RULES,
} from '../../server/scoring.js';

const finalMatch = (home, away, stage = 'group') => ({
  id: 'm', stage, status: 'final', home_score: home, away_score: away,
});
const pred = (home, away) => ({ home_pred: home, away_pred: away });

test('exact score stacks result + exact + over/under', () => {
  // 2-1 (3 goals → over): result 3 + exact 5 + over/under 2 = 10
  assert.deepEqual(scoreBreakdown(pred(2, 1), finalMatch(2, 1)), {
    result: 3, exact: 5, goalDiff: 0, overUnder: 2, base: 10, multiplier: 1, total: 10,
  });
});

test('correct result + goal difference (not exact)', () => {
  // predicted 2-1, actual 3-2: result 3 + goalDiff 2 + over/under 2 = 7
  const bd = scoreBreakdown(pred(2, 1), finalMatch(3, 2));
  assert.equal(bd.result, 3);
  assert.equal(bd.exact, 0);
  assert.equal(bd.goalDiff, 2);
  assert.equal(bd.overUnder, 2);
  assert.equal(bd.total, 7);
});

test('correct result only (wrong margin) still scores over/under', () => {
  // predicted 2-0 (under 2.5), actual 1-0 (under 2.5): result 3 + over/under 2 = 5
  assert.equal(scorePrediction(pred(2, 0), finalMatch(1, 0)), 5);
});

test('over/under scores independently of the result', () => {
  // predicted 0-1 (away win, total 1 under), actual 2-0 (home win, total 2 under)
  // wrong result, but both under 2.5 → over/under 2
  assert.equal(scorePrediction(pred(0, 1), finalMatch(2, 0)), 2);
});

test('completely wrong = 0', () => {
  // predicted 0-0 (draw, under), actual 3-1 (home win, over): nothing hits
  assert.equal(scorePrediction(pred(0, 0), finalMatch(3, 1)), 0);
});

test('exact draw stacks markets', () => {
  // 1-1 (under 2.5): result 3 + exact 5 + over/under 2 = 10
  assert.equal(scorePrediction(pred(1, 1), finalMatch(1, 1)), 10);
});

test('knockout multiplier scales the whole base', () => {
  const rules = { ...DEFAULT_RULES, knockoutMultiplier: 2 };
  assert.equal(scorePrediction(pred(2, 1), finalMatch(2, 1, 'group'), rules), 10);
  assert.equal(scorePrediction(pred(2, 1), finalMatch(2, 1, 'F'), rules), 20);
});

test('no points before a match is final', () => {
  assert.equal(scorePrediction(pred(2, 1), { stage: 'group', status: 'upcoming', home_score: null, away_score: null }), 0);
});

test('no prediction = 0 points', () => {
  assert.equal(scorePrediction(null, finalMatch(1, 0)), 0);
});

test('leaderboard adds custom (extra) points and ranks correctly', () => {
  const players = [
    { id: 'a', display_name: 'A', joined_seq: 1 },
    { id: 'b', display_name: 'B', joined_seq: 2 },
    { id: 'c', display_name: 'C', joined_seq: 3 },
  ];
  const matches = [finalMatch(1, 0)];
  const predictions = [
    { player_id: 'a', match_id: 'm', home_pred: 1, away_pred: 0 }, // exact → 3+5+2 = 10
    { player_id: 'b', match_id: 'm', home_pred: 2, away_pred: 0 }, // result+ou → 3+2 = 5
  ];
  // C scored 8 on a custom bet, no match predictions
  const lb = buildLeaderboard(players, predictions, matches, DEFAULT_RULES, { c: 8 });
  assert.deepEqual(lb.map((r) => r.name), ['A', 'C', 'B']);
  assert.equal(lb[0].matchPoints, 10);
  assert.equal(lb[0].customPoints, 0);
  assert.equal(lb[1].name, 'C');
  assert.equal(lb[1].customPoints, 8);
  assert.equal(lb[1].points, 8);
  assert.equal(lb[2].points, 5);
});

test('group standings order by points, GD, GF', () => {
  const teams = [
    { code: 'AAA', group: 'A' }, { code: 'BBB', group: 'A' },
    { code: 'CCC', group: 'A' }, { code: 'DDD', group: 'A' },
  ];
  const m = (id, h, a, hs, as_) => ({ id, stage: 'group', group: 'A', status: 'final', home: h, away: a, home_score: hs, away_score: as_ });
  const matches = [
    m(1, 'AAA', 'BBB', 3, 0), m(2, 'CCC', 'DDD', 1, 1), m(3, 'AAA', 'CCC', 1, 0),
    m(4, 'BBB', 'DDD', 2, 2), m(5, 'AAA', 'DDD', 2, 0), m(6, 'BBB', 'CCC', 0, 1),
  ];
  const a = computeGroupStandings(teams, matches).get('A');
  assert.equal(a[0].team, 'AAA');
  assert.equal(a[0].points, 9);
  assert.equal(a[0].complete, true);
  assert.equal(a[1].team, 'CCC');
});

test('selectBestThirds returns null until every group is complete', () => {
  const teams = [{ code: 'AAA', group: 'A' }, { code: 'BBB', group: 'A' }, { code: 'CCC', group: 'A' }, { code: 'DDD', group: 'A' }];
  const partial = [{ id: 1, stage: 'group', group: 'A', status: 'final', home: 'AAA', away: 'BBB', home_score: 1, away_score: 0 }];
  assert.equal(selectBestThirds(computeGroupStandings(teams, partial)), null);
});
