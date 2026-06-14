import { useEffect, useState } from 'preact/hooks';
import { loadBreakdown, earnings } from '../lib/store.js';
import { money, signed } from '../lib/helpers.js';

const POOL_SHORT = { WINNER_BIG: 'Winner · Big', EXACT: 'Exact Score', WINNER_SMALL: 'Winner · Small', TOTAL: 'Total Goals', MARGIN: 'Margin' };

export function EarningsSheet({ onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { loadBreakdown().then(setData).catch(() => setData({ total: earnings.value.total, rows: [] })); }, []);

  const total = data ? data.total : earnings.value.total;
  return (
    <div class="scrim" onClick={onClose}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="spread">
          <span class="section-label">Total earnings</span>
          <button class="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div class={`sheet-total num ${total > 0 ? 'pos' : total < 0 ? 'neg' : ''}`}>{signed(total)}</div>
        <p class="muted" style="font-size:.85rem;margin-bottom:10px">Winnings and refunds minus entry fees, across every pool you’ve entered.</p>

        {!data ? (
          <div class="empty">Loading…</div>
        ) : data.rows.length === 0 ? (
          <div class="empty"><div class="em-ic">🎟️</div><p>No entries yet. Enter a pool from a fixture to get started.</p></div>
        ) : (
          <div>
            {data.rows.map((r) => {
              const res = r.status === 'won' ? ['won', 'Won'] : r.refunded ? ['refund', 'Refund'] : r.status === 'lost' ? ['lost', 'Lost'] : ['pending', 'Open'];
              return (
                <div class="earn-row" key={r.poolId}>
                  <div class="ef">
                    <div class="fx">{r.fixture}</div>
                    <div class="pl">{POOL_SHORT[r.poolType] || r.poolType} · entry {money(r.fee)}{r.gross ? ` · won ${money(r.gross)}` : ''}</div>
                  </div>
                  <span class={`res ${res[0]}`}>{res[1]}</span>
                  <span class={`net num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}`}>{signed(r.net)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
