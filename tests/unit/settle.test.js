import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME, DRAW, AWAY, resultFromScore, isCorrect, settlePool, provisional,
} from '../../server/settle.js';

const R = (h, a, opts = {}) => resultFromScore({ homeGoals: h, awayGoals: a, ...opts });
const entry = (id, pred, t) => ({ id, pred, created_at: t });

test('winner pool correctness (group, draw allowed)', () => {
  assert.equal(isCorrect('WINNER_BIG', { winner: HOME }, R(2, 1)), true);
  assert.equal(isCorrect('WINNER_BIG', { winner: DRAW }, R(1, 1)), true);
  assert.equal(isCorrect('WINNER_BIG', { winner: AWAY }, R(1, 1)), false);
});

test('exact pool needs both goals', () => {
  assert.equal(isCorrect('EXACT', { home: 2, away: 1 }, R(2, 1)), true);
  assert.equal(isCorrect('EXACT', { home: 2, away: 1 }, R(3, 1)), false);
});

test('total pool', () => {
  assert.equal(isCorrect('TOTAL', { total: 3 }, R(2, 1)), true);
  assert.equal(isCorrect('TOTAL', { total: 3 }, R(1, 1)), false);
});

test('margin pool (winner + exact margin; draw = 0)', () => {
  assert.equal(isCorrect('MARGIN', { winner: HOME, margin: 1 }, R(2, 1)), true);
  assert.equal(isCorrect('MARGIN', { winner: HOME, margin: 2 }, R(2, 1)), false);
  assert.equal(isCorrect('MARGIN', { winner: DRAW, margin: 0 }, R(1, 1)), true);
  assert.equal(isCorrect('MARGIN', { winner: AWAY, margin: 1 }, R(2, 1)), false);
});

test('knockout: pens decide winner; scoreline excludes pens', () => {
  // 1–1 in ET, away win on penalties
  const res = R(1, 1, { knockout: true, penWinner: AWAY });
  assert.equal(res.winner, AWAY);
  assert.equal(isCorrect('WINNER_BIG', { winner: AWAY }, res), true);
  assert.equal(isCorrect('EXACT', { home: 1, away: 1 }, res), true, 'scoreline is 1-1, pens excluded');
  assert.equal(isCorrect('TOTAL', { total: 2 }, res), true);
  // ET margin is 0 but the winner is AWAY (progressing side). A *valid* margin
  // pick for a non-draw side is margin ≥ 1, so no margin entrant can win a
  // pen-decided draw → the pool refunds. A 1-margin AWAY pick is wrong here.
  assert.equal(isCorrect('MARGIN', { winner: AWAY, margin: 1 }, res), false);
});

test('provisional knockout level has no winner', () => {
  const res = R(1, 1, { knockout: true, penWinner: null });
  assert.equal(res.winner, null);
  assert.equal(isCorrect('WINNER_BIG', { winner: HOME }, res), false);
});

test('settlePool: equal split among correct', () => {
  const entries = [
    entry('a', { winner: HOME }, '1'),
    entry('b', { winner: HOME }, '2'),
    entry('c', { winner: AWAY }, '3'),
  ];
  const r = settlePool({ type: 'WINNER_BIG', entries, fee: 1000, result: R(2, 0) });
  assert.equal(r.prizePool, 3000);
  assert.equal(r.correctCount, 2);
  const a = r.payouts.find((p) => p.entryId === 'a');
  const b = r.payouts.find((p) => p.entryId === 'b');
  const c = r.payouts.find((p) => p.entryId === 'c');
  assert.equal(a.amount, 1500);
  assert.equal(b.amount, 1500);
  assert.equal(c.kind, 'loss');
  assert.equal(c.amount, 0);
});

test('settlePool: exactly one correct takes the whole pot', () => {
  const entries = [entry('a', { winner: HOME }, '1'), entry('b', { winner: DRAW }, '2')];
  const r = settlePool({ type: 'WINNER_BIG', entries, fee: 500, result: R(2, 0) });
  assert.equal(r.payouts.find((p) => p.entryId === 'a').amount, 1000);
  assert.equal(r.correctCount, 1);
});

test('settlePool: zero correct refunds everyone', () => {
  const entries = [entry('a', { winner: DRAW }, '1'), entry('b', { winner: AWAY }, '2')];
  const r = settlePool({ type: 'WINNER_BIG', entries, fee: 500, result: R(2, 0) });
  assert.equal(r.refunded, true);
  assert.equal(r.correctCount, 0);
  assert.ok(r.payouts.every((p) => p.kind === 'refund' && p.amount === 500));
});

test('settlePool: rounding remainder goes to earliest correct entrants', () => {
  // pot 3*500=1500, 4 correct → base 375, remainder 0… use 7 correct of fee 100 → 700/7=100 exact
  // make a remainder: 3 correct, pot 1000 → base 333, remainder 1
  const entries = [
    entry('a', { winner: HOME }, '2025-01-01T00:00:01Z'),
    entry('b', { winner: HOME }, '2025-01-01T00:00:02Z'),
    entry('c', { winner: HOME }, '2025-01-01T00:00:03Z'),
  ];
  const r = settlePool({ type: 'WINNER_BIG', entries, fee: 1000, result: R(2, 0) });
  // pot 3000 / 3 = 1000 exact — change fee to force remainder
  const r2 = settlePool({ type: 'WINNER_BIG', entries: entries.slice(0, 3), fee: 1000, result: R(2, 0) });
  assert.equal(r2.prizePool, 3000);
  // craft remainder: 3 entries, pot not divisible → fee 1000, drop one to 2 correct? do explicit:
  const three = [
    entry('a', { total: 3 }, '2025-01-01T00:00:01Z'),
    entry('b', { total: 3 }, '2025-01-01T00:00:02Z'),
    entry('c', { total: 3 }, '2025-01-01T00:00:03Z'),
  ];
  const rr = settlePool({ type: 'TOTAL', entries: three, fee: 1000, result: R(2, 1) }); // pot 3000/3=1000 exact
  assert.equal(rr.payouts.reduce((s, p) => s + p.amount, 0), 3000);
  // force a true remainder: 4 entrants, 3 correct, pot 4*1000=4000 /3 = 1333 r1
  const four = [
    entry('a', { total: 3 }, '2025-01-01T00:00:01Z'),
    entry('b', { total: 3 }, '2025-01-01T00:00:02Z'),
    entry('c', { total: 3 }, '2025-01-01T00:00:03Z'),
    entry('d', { total: 9 }, '2025-01-01T00:00:04Z'),
  ];
  const r4 = settlePool({ type: 'TOTAL', entries: four, fee: 1000, result: R(2, 1) });
  assert.equal(r4.prizePool, 4000);
  assert.equal(r4.correctCount, 3);
  const amt = (id) => r4.payouts.find((p) => p.entryId === id).amount;
  assert.equal(amt('a'), 1334, 'earliest correct gets the extra Rs');
  assert.equal(amt('b'), 1333);
  assert.equal(amt('c'), 1333);
  assert.equal(amt('d'), 0);
  assert.equal(amt('a') + amt('b') + amt('c'), 4000, 'books are exact, no Rs lost');
  // keep r referenced
  assert.equal(r.prizePool, 3000);
});

test('settlePool is deterministic (idempotent re-run gives identical payouts)', () => {
  const entries = [
    entry('a', { winner: HOME }, '1'),
    entry('b', { winner: HOME }, '2'),
    entry('c', { winner: AWAY }, '3'),
  ];
  const a1 = settlePool({ type: 'WINNER_SMALL', entries, fee: 500, result: R(1, 0) });
  const a2 = settlePool({ type: 'WINNER_SMALL', entries, fee: 500, result: R(1, 0) });
  assert.deepEqual(a1, a2);
});

test('rake reduces the prize pool', () => {
  const entries = [entry('a', { winner: HOME }, '1'), entry('b', { winner: HOME }, '2')];
  const r = settlePool({ type: 'WINNER_BIG', entries, fee: 1000, rake: 0.1, result: R(1, 0) });
  assert.equal(r.prizePool, 1800); // floor(2000 * 0.9)
});

test('provisional: currently-winning sort to top with projected share', () => {
  const entries = [
    entry('a', { winner: AWAY }, '1'),
    entry('b', { winner: HOME }, '2'),
    entry('c', { winner: HOME }, '3'),
  ];
  const p = provisional({ type: 'WINNER_BIG', entries, fee: 1000, result: R(0, 1) }); // away leading
  assert.equal(p.correctCount, 1);
  assert.equal(p.rows[0].entry.id, 'a');
  assert.equal(p.rows[0].correct, true);
  assert.equal(p.rows[0].projectedShare, 3000); // sole correct → whole projected pot
});

test('provisional: exact-score ranks the rest by closeness', () => {
  const entries = [
    entry('a', { home: 2, away: 2 }, '1'),
    entry('b', { home: 2, away: 1 }, '2'), // exact at live 2-1
    entry('c', { home: 0, away: 0 }, '3'),
  ];
  const p = provisional({ type: 'EXACT', entries, fee: 500, result: R(2, 1) });
  assert.equal(p.rows[0].entry.id, 'b', 'exact match leads');
  assert.equal(p.rows[1].entry.id, 'a', 'distance 1 next');
  assert.equal(p.rows[2].entry.id, 'c', 'distance 3 last');
});
