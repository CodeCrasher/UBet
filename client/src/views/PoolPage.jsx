import { useState } from 'preact/hooks';
import { poolView, goFixture, enterPool, showToast } from '../lib/store.js';
import { ToteBoard } from '../components/ToteBoard.jsx';
import { PredictionInput, predReady } from '../components/PredictionInput.jsx';
import { money, predText, PHASE_LABEL } from '../lib/helpers.js';

export function PoolPage() {
  const data = poolView.value;
  const [pred, setPred] = useState({});
  const [busy, setBusy] = useState(false);
  if (!data) return <div class="empty">Loading…</div>;

  const { standing, fixture, myEntry, winnerOptions, me } = data;
  const { meta } = standing;
  const live = fixture.status === 'live';
  const final = fixture.status === 'final';
  const open = meta.status === 'open';

  async function placePick() {
    setBusy(true);
    try {
      await enterPool(standing.poolId, pred);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button class="back-link" onClick={() => goFixture(fixture.num)}>← {fixture.homeLabel} v {fixture.awayLabel}</button>

      {/* live score header */}
      <div class="live-head">
        <Team t={fixture.homeTeam} label={fixture.homeLabel} />
        <div class="lh-mid">
          <div class="sc num">
            {final ? `${fixture.homeScore}–${fixture.awayScore}` : `${meta.live.homeGoals}–${meta.live.awayGoals}`}
          </div>
          <div class="min">{final ? 'Full time' : live ? `${meta.live.minute}' · ${PHASE_LABEL[meta.live.phase]}` : 'Not started'}</div>
        </div>
        <Team t={fixture.awayTeam} label={fixture.awayLabel} />
      </div>

      {/* the tote board */}
      <ToteBoard standing={standing} fixture={fixture} meId={me} />

      {/* my slip */}
      <div class="myslip">
        {myEntry ? (
          <>
            <h3>Your pick</h3>
            <p class="muted" style="margin-top:2px">{meta.name} · entry {money(meta.fee)}</p>
            <div class="display" style="font-size:1.6rem;margin:10px 0 2px">{predText(meta.type, myEntry.pred, fixture)}</div>
            <p class="muted" style="font-size:.85rem">
              {final ? 'Settled — see the board above.' : live ? 'Locked in. Watch the board swing live.' : 'Locked in. Editable? No — picks are final once placed.'}
            </p>
          </>
        ) : open ? (
          <>
            <h3>Place your pick</h3>
            <p class="muted" style="margin-top:2px">{meta.mechanic} · entry {money(meta.fee)}</p>
            <PredictionInput type={meta.type} winnerOptions={winnerOptions} fixture={fixture} pred={pred} setPred={setPred} />
            <button class="btn btn-primary btn-block" disabled={busy || !predReady(meta.type, pred)} onClick={placePick}>
              {busy ? 'Placing…' : `Enter pool · ${money(meta.fee)}`}
            </button>
          </>
        ) : (
          <div class="lock-msg">🔒 This pool is {meta.status === 'settled' ? 'settled' : 'locked'} — you didn’t enter.</div>
        )}
      </div>
    </div>
  );
}

function Team({ t, label }) {
  return (
    <div class="lh-team">
      <span class="flag">{t ? t.flag : '🏳️'}</span>
      <span class="abbr">{t ? t.code : (label || '—')}</span>
    </div>
  );
}
