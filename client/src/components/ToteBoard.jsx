import { useLayoutEffect, useRef } from 'preact/hooks';
import { FlipNumber } from './FlipNumber.jsx';
import { predText } from '../lib/helpers.js';

// The signature element: a stadium tote board. Pot flips, rows slide to their
// new positions, and a newly-winning row gets a one-shot signal sweep.
export function ToteBoard({ standing, fixture, meId }) {
  const { meta, rows } = standing;
  const live = meta.status === 'locked';
  const settled = meta.status === 'settled';
  const potValue = live ? meta.projectedPot : meta.pot;

  const listRef = useRef(null);
  const posRef = useRef(new Map());
  const winnersRef = useRef(new Set());
  const sweepRef = useRef(new Set());

  // detect newly-winning rows for the sweep
  const nowWinners = new Set(rows.filter((r) => r.currentlyWinning).map((r) => r.userId));
  sweepRef.current = new Set([...nowWinners].filter((id) => !winnersRef.current.has(id)));
  winnersRef.current = nowWinners;

  // FLIP slide on reorder
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.querySelectorAll('[data-uid]').forEach((node) => {
      const id = node.dataset.uid;
      const top = node.offsetTop;
      const prev = posRef.current.get(id);
      if (prev != null && prev !== top && !reduce) {
        node.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'translateY(0)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      posRef.current.set(id, top);
    });
  });

  const showRefundNote = live && meta.correctCount === 0 && rows.length > 0;
  const refundedNote = settled && meta.refunded;

  return (
    <section class="board" aria-label="Pool tote board">
      <div class="board-head">
        <span class="ttl">{meta.name}</span>
        <span class={`pill ${live ? 'live' : settled ? 'final' : 'upcoming'}`}>
          {live ? <><span class="dot" /> Live</> : settled ? 'Final' : 'Open'}
        </span>
      </div>

      <div class="board-pot">
        <div class={`k ${live ? 'label-proj' : ''}`}>{live ? 'Projected pot' : 'Prize pot'}</div>
        <FlipNumber value={potValue} prefix="Rs" />
      </div>

      {rows.length === 0 ? (
        <div class="board-note">No entries yet — be the first to place a pick.</div>
      ) : (
        <div class="board-rows" ref={listRef}>
          {rows.map((r, i) => {
            const badge = settled
              ? r.correct ? ['won', 'Won'] : meta.refunded ? ['refund', 'Refund'] : ['lost', 'Out']
              : live
                ? r.currentlyWinning ? ['win', 'Currently winning'] : ['trail', 'Trailing']
                : null;
            return (
              <div
                key={r.userId}
                data-uid={r.userId}
                class={`brow ${r.userId === meId ? 'me' : ''} ${r.currentlyWinning || (settled && r.correct) ? 'winning' : ''}`}
              >
                {sweepRef.current.has(r.userId) ? <span class="sweep go" /> : null}
                <div class="rank num">{i + 1}</div>
                <div class="who">
                  <div class="nm">{r.name}{r.userId === meId ? <span class="you">YOU</span> : null}</div>
                  <div class="pick">{predText(meta.type, r.pred, fixture)}</div>
                </div>
                <div class="end">
                  {badge ? <span class={`badge ${badge[0]}`}>{badge[1]}</span> : null}
                  {live && r.currentlyWinning ? <div class="share num">Rs {r.projectedShare.toLocaleString('en-IN')}</div> : null}
                  {settled && r.payout > 0 ? <div class="share num">Rs {r.payout.toLocaleString('en-IN')}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showRefundNote ? <div class="board-note refund">No one is currently winning — pot would refund at this score.</div> : null}
      {refundedNote ? <div class="board-note refund">Pot refunded — no correct picks. Everyone got their entry back.</div> : null}
    </section>
  );
}
