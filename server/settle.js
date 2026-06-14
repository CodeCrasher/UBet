// THE shared correctness + payout core. Pure, deterministic, no I/O.
// Both the live provisional standings and the final pari-mutuel settlement go
// through these functions, fed by either the live score or the confirmed final
// score — so "currently winning" and "actually paid" can never drift.

export const HOME = 'HOME';
export const DRAW = 'DRAW';
export const AWAY = 'AWAY';

export const POOL_TYPES = ['WINNER_BIG', 'EXACT', 'WINNER_SMALL', 'TOTAL', 'MARGIN'];
const isWinnerPool = (t) => t === 'WINNER_BIG' || t === 'WINNER_SMALL';

/**
 * Resolve the winning side from a scoreline.
 * Knockout + level: `penWinner` decides the final; for a live/provisional level
 * KO score there is no winner yet → null (nobody is provisionally correct).
 */
export function resolveWinner({ homeGoals, awayGoals, knockout = false, penWinner = null }) {
  if (homeGoals > awayGoals) return HOME;
  if (awayGoals > homeGoals) return AWAY;
  if (!knockout) return DRAW;
  return penWinner || null;
}

/** Build the canonical result object the correctness fns consume. */
export function resultFromScore({ homeGoals, awayGoals, knockout = false, penWinner = null }) {
  return {
    homeGoals,
    awayGoals,
    total: homeGoals + awayGoals,
    margin: Math.abs(homeGoals - awayGoals),
    winner: resolveWinner({ homeGoals, awayGoals, knockout, penWinner }),
  };
}

/** Is a single prediction correct against a result? */
export function isCorrect(type, pred, result) {
  if (!pred) return false;
  switch (type) {
    case 'WINNER_BIG':
    case 'WINNER_SMALL':
      return result.winner != null && pred.winner === result.winner;
    case 'EXACT':
      return pred.home === result.homeGoals && pred.away === result.awayGoals;
    case 'TOTAL':
      return pred.total === result.total;
    case 'MARGIN':
      if (result.winner == null) return false;
      if (result.winner === DRAW) return pred.winner === DRAW && pred.margin === 0;
      return pred.winner === result.winner && pred.margin === result.margin;
    default:
      return false;
  }
}

/** Display-only closeness for provisional ordering (lower = nearer). */
export function closeness(type, pred, result) {
  if (!pred) return Infinity;
  switch (type) {
    case 'EXACT':
      return Math.abs(pred.home - result.homeGoals) + Math.abs(pred.away - result.awayGoals);
    case 'TOTAL':
      return Math.abs(pred.total - result.total);
    case 'MARGIN': {
      const winRight = result.winner != null && pred.winner === result.winner ? 0 : 1;
      return winRight * 100 + Math.abs(pred.margin - result.margin);
    }
    default: // winner pools
      return result.winner != null && pred.winner === result.winner ? 0 : 1;
  }
}

const byEntryOrder = (a, b) =>
  String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));

/**
 * Final pari-mutuel settlement for one pool. Pure: returns the intended payouts;
 * the caller moves balances inside a transaction.
 *
 * @returns {{ prizePool, correctCount, refunded, payouts:[{entryId,correct,kind,amount}] }}
 *   kind ∈ 'winnings' | 'refund' | 'loss'.
 */
export function settlePool({ type, entries, fee, rake = 0, result }) {
  if (!entries.length) return { prizePool: 0, correctCount: 0, refunded: false, payouts: [] };
  const prizePool = Math.floor(fee * entries.length * (1 - rake));
  const correct = entries.filter((e) => isCorrect(type, e.pred, result));

  // Zero correct → refund every entrant their fee; pot dissolves.
  if (correct.length === 0) {
    return {
      prizePool,
      correctCount: 0,
      refunded: true,
      payouts: entries.map((e) => ({ entryId: e.id, correct: false, kind: 'refund', amount: fee })),
    };
  }

  // Equal split; whole Rs; remainder one-by-one to correct entrants by entry time.
  const base = Math.floor(prizePool / correct.length);
  const remainder = prizePool - base * correct.length;
  const ordered = [...correct].sort(byEntryOrder);
  const amountById = new Map();
  ordered.forEach((e, i) => amountById.set(e.id, base + (i < remainder ? 1 : 0)));
  const correctSet = new Set(correct.map((e) => e.id));

  return {
    prizePool,
    correctCount: correct.length,
    refunded: false,
    payouts: entries.map((e) =>
      correctSet.has(e.id)
        ? { entryId: e.id, correct: true, kind: 'winnings', amount: amountById.get(e.id) }
        : { entryId: e.id, correct: false, kind: 'loss', amount: 0 },
    ),
  };
}

/**
 * Provisional standing for one pool against the CURRENT (live) result.
 * Display/projection only — no balances move. Shares isCorrect with settlement.
 * @returns {{ rows:[{entry,correct,distance,projectedShare}], correctCount, projectedPot }}
 */
export function provisional({ type, entries, fee, rake = 0, result }) {
  const projectedPot = Math.floor(fee * entries.length * (1 - rake));
  const scored = entries.map((e) => ({
    entry: e,
    correct: isCorrect(type, e.pred, result),
    distance: closeness(type, e.pred, result),
  }));
  const correctCount = scored.filter((s) => s.correct).length;
  const share = correctCount > 0 ? Math.floor(projectedPot / correctCount) : 0;
  for (const s of scored) s.projectedShare = s.correct ? share : 0;
  scored.sort(
    (a, b) => Number(b.correct) - Number(a.correct) || a.distance - b.distance || byEntryOrder(a.entry, b.entry),
  );
  return { rows: scored, correctCount, projectedPot, isWinnerPool: isWinnerPool(type) };
}
