import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scorePrediction,
  classifyPrediction,
  buildLeaderboard,
  computeGroupStandings,
  selectBestThirds,
  DEFAULT_RULES,
} from '../../server/scoring.js';

const finalMatch = (home, away, stage = 'group') => ({
  id: 'm', stage, status: 'final', home_score: home, away_score: away,
});
const pred = (home, away) => ({ home_pred: home, away_pred: away });

test('exact scoreline = 5', () => {
  assert.equal(scorePrediction(pred(2, 1), finalMatch(2, 1)), 5);
});

test('correct result + goal difference (not exact) = 3', () => {
  // predicted 2-1 (home by 1), actual 3-2 (home by 1)
  assert.equal(scorePrediction(pred(2, 1), finalMatch(3, 2)), 3);
});

test('drawn scoreline, correct GD of 0 but not exact = 3', () => {
  assert.equal(scorePrediction(pred(1, 1), finalMatch(2, 2)), 3);
});

test('correct result only = 1', () => {
  // predicted 2-0 (home by 2), actual 1-0 (home by 1): same result, diff GD
  assert.equal(scorePrediction(pred(2, 0), finalMatch(1, 0)), 1);
});

test('wrong result = 0', () => {
  assert.equal(scorePrediction(pred(0, 1), finalMatch(2, 0)), 0);
});

test('exact draw = 5', () => {
  assert.equal(scorePrediction(pred(1, 1), finalMatch(1, 1)), 5);
});

test('knockout multiplier applies only to knockout stages', () => {
  const rules = { ...DEFAULT_RULES, knockoutMultiplier: 2 };
  assert.equal(scorePrediction(pred(2, 1), finalMatch(2, 1, 'group'), rules), 5);
  assert.equal(scorePrediction(pred(2, 1), finalMatch(2, 1, 'R16'), rules), 10);
  assert.equal(scorePrediction(pred(2, 1), finalMatch(2, 1, 'F'), rules), 10);
});

test('no points before a match is final', () => {
  assert.equal(scorePrediction(pred(2, 1), { stage: 'group', status: 'upcoming', home_score: null, away_score: null }), 0);
});

test('no prediction = 0 points', () => {
  assert.equal(scorePrediction(null, finalMatch(1, 0)), 0);
});

test('classifyPrediction labels each tier', () => {
  assert.equal(classifyPrediction(pred(2, 1), finalMatch(2, 1)), 'exact');
  assert.equal(classifyPrediction(pred(2, 1), finalMatch(3, 2)), 'resultGd');
  assert.equal(classifyPrediction(pred(2, 0), finalMatch(1, 0)), 'result');
  assert.equal(classifyPrediction(pred(0, 1), finalMatch(2, 0)), 'miss');
  assert.equal(classifyPrediction(pred(0, 1), { stage: 'group', status: 'upcoming' }), null);
});

test('leaderboard ranks by points, then exact count, then correct results', () => {
  const players = [
    { id: 'a', display_name: 'A', joined_seq: 1 },
    { id: 'b', display_name: 'B', joined_seq: 2 },
    { id: 'c', display_name: 'C', joined_seq: 3 },
  ];
  const matches = [finalMatch(2, 1), { ...finalMatch(0, 0), id: 'm2' }];
  const predictions = [
    // A: 5 (exact) + 1 (result) = 6, exact=1
    { player_id: 'a', match_id: 'm', home_pred: 2, away_pred: 1 },
    { player_id: 'a', match_id: 'm2', home_pred: 1, away_pred: 1 },
    // B: 5 (exact) + 5 (exact) = 10, exact=2
    { player_id: 'b', match_id: 'm', home_pred: 2, away_pred: 1 },
    { player_id: 'b', match_id: 'm2', home_pred: 0, away_pred: 0 },
    // C: 5 + 5 = 10, exact=2 — ties B on points & exact, broken by joined_seq
    { player_id: 'c', match_id: 'm', home_pred: 2, away_pred: 1 },
    { player_id: 'c', match_id: 'm2', home_pred: 0, away_pred: 0 },
  ];
  const lb = buildLeaderboard(players, predictions, matches);
  assert.deepEqual(lb.map((r) => r.name), ['B', 'C', 'A']);
  assert.equal(lb[0].points, 10);
  assert.equal(lb[0].exact, 2);
  assert.equal(lb[0].rank, 1);
  assert.equal(lb[1].rank, 1); // B and C share rank 1 (same stat line)
  assert.equal(lb[2].rank, 3); // A
});

test('group standings order by points, GD, GF', () => {
  const teams = [
    { code: 'AAA', group: 'A' }, { code: 'BBB', group: 'A' },
    { code: 'CCC', group: 'A' }, { code: 'DDD', group: 'A' },
  ];
  const m = (id, h, a, hs, as_) => ({ id, stage: 'group', group: 'A', status: 'final', home: h, away: a, home_score: hs, away_score: as_ });
  const matches = [
    m(1, 'AAA', 'BBB', 3, 0), // AAA win
    m(2, 'CCC', 'DDD', 1, 1), // draw
    m(3, 'AAA', 'CCC', 1, 0), // AAA win
    m(4, 'BBB', 'DDD', 2, 2), // draw
    m(5, 'AAA', 'DDD', 2, 0), // AAA win
    m(6, 'BBB', 'CCC', 0, 1), // CCC win
  ];
  const standings = computeGroupStandings(teams, matches);
  const a = standings.get('A');
  assert.equal(a[0].team, 'AAA'); // 9 pts
  assert.equal(a[0].points, 9);
  assert.equal(a[0].complete, true);
  assert.equal(a[1].team, 'CCC'); // 4 pts
});

test('selectBestThirds returns null until every group is complete', () => {
  const teams = [{ code: 'AAA', group: 'A' }, { code: 'BBB', group: 'A' }, { code: 'CCC', group: 'A' }, { code: 'DDD', group: 'A' }];
  const partial = [{ id: 1, stage: 'group', group: 'A', status: 'final', home: 'AAA', away: 'BBB', home_score: 1, away_score: 0 }];
  assert.equal(selectBestThirds(computeGroupStandings(teams, partial)), null);
});
