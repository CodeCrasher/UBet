import { poolState, isHost, togglePaid, showToast } from '../lib/store.js';
import { CountUp } from './CountUp.jsx';
import { initials, colorFor, money } from '../lib/helpers.js';

export function Pot() {
  const state = poolState.value;
  if (!state) return null;
  const { pot } = state;
  const paidCount = pot.contributors.filter((c) => c.paid).length;
  const total = pot.contributors.length;
  const paidPct = total ? (paidCount / total) * 100 : 0;

  return (
    <section class="pot" aria-label="Prize pot">
      <div class="pot-head">
        <span class="pot-label">🏆 Prize pot</span>
        <span class="pot-sub">{total} player{total === 1 ? '' : 's'} · {money(pot.buyIn, pot.currency)} buy-in</span>
      </div>

      <div class="pot-value num">
        <CountUp
          value={pot.total}
          render={(v) => {
            const formatted = money(v, pot.currency);
            // split currency symbol from the number for styling
            const m = formatted.match(/^([^\d]*)(.*)$/);
            return (
              <>
                {m && m[1] ? <span class="cur">{m[1].trim()}</span> : null}
                {m ? m[2] : Math.round(v)}
              </>
            );
          }}
        />
      </div>
      <div class="pot-sub">Winner takes all when the tournament ends</div>

      <div class="pot-meter" role="progressbar" aria-valuenow={paidCount} aria-valuemax={total}>
        <span style={{ width: `${paidPct}%` }} />
      </div>
      <div class="pot-meter-label">
        <span>{money(pot.paidTotal, pot.currency)} collected</span>
        <span>{paidCount}/{total} paid up</span>
      </div>

      {pot.projectedWinner ? (
        <div class="winner">
          <span class="tro">👑</span>
          <div>
            <div class="w-name">{pot.projectedWinner.name}</div>
            <div class="w-meta">Projected winner</div>
          </div>
          <div class="w-pts num">{pot.projectedWinner.points} pts</div>
        </div>
      ) : null}
    </section>
  );
}

export function Contributors() {
  const state = poolState.value;
  if (!state) return null;
  const host = isHost.value;

  async function flip(c) {
    if (!host) return;
    try {
      await togglePaid(c.playerId, !c.paid);
    } catch (e) {
      showToast(e.message);
    }
  }

  return (
    <div class="card card-pad">
      <div class="spread" style="margin-bottom:8px">
        <span class="section-title">Buy-ins</span>
        <span class="faint" style="font-size:.78rem">{host ? 'Tap a tag to toggle' : 'Host tracks payments'}</span>
      </div>
      <div class="contribs">
        {state.pot.contributors.map((c) => (
          <div class="contrib" key={c.playerId}>
            <span class="av" style={{ background: colorFor(c.playerId) }}>{initials(c.name)}</span>
            <span class="c-name">{c.name}</span>
            <button
              class={`paytag ${c.paid ? 'paid' : 'unpaid'} ${host ? 'toggle' : ''}`}
              onClick={() => flip(c)}
              disabled={!host}
            >
              {c.paid ? '✓ Paid' : 'Unpaid'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
