import { useState } from 'preact/hooks';
import { adminPin, adminCheck, adminLive, adminResult, poolView, fixtureView, showToast } from '../lib/store.js';

const PHASES = ['NOT_STARTED', 'FIRST_HALF', 'HALFTIME', 'SECOND_HALF', 'ET', 'PENS', 'FULL_TIME'];

export function AdminPanel({ onClose }) {
  const [pin, setPin] = useState(adminPin.value);
  const [verified, setVerified] = useState(!!adminPin.value);
  const [err, setErr] = useState('');

  async function verify(e) {
    e.preventDefault();
    setErr('');
    try {
      await adminCheck(pin);
      setVerified(true);
    } catch (e2) {
      setErr(e2.message);
    }
  }

  const fixture = poolView.value?.fixture || fixtureView.value?.fixture || null;

  return (
    <div class="scrim" onClick={onClose}>
      <div class="sheet" onClick={(e) => e.stopPropagation()} style="max-width:460px">
        <div class="spread">
          <span class="section-label">⚙ Admin</span>
          <button class="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        {!verified ? (
          <form onSubmit={verify} style="margin-top:14px">
            {err ? <div class="error-banner">{err}</div> : null}
            <div class="field">
              <label>Admin PIN</label>
              <input class="input" type="password" value={pin} onInput={(e) => setPin(e.target.value)} placeholder="••••" autoFocus />
            </div>
            <button class="btn btn-primary btn-block">Unlock admin</button>
          </form>
        ) : !fixture ? (
          <p class="muted" style="margin-top:14px">Open a fixture or pool first — admin controls act on the fixture you’re viewing.</p>
        ) : (
          <AdminControls fixture={fixture} />
        )}
      </div>
    </div>
  );
}

function AdminControls({ fixture }) {
  const live = fixture.live || { homeGoals: 0, awayGoals: 0, minute: 0, phase: 'NOT_STARTED' };
  const [hg, setHg] = useState(live.homeGoals);
  const [ag, setAg] = useState(live.awayGoals);
  const [minute, setMinute] = useState(live.minute || 0);
  const [phase, setPhase] = useState(live.phase || 'SECOND_HALF');
  const [fh, setFh] = useState(fixture.homeScore ?? 0);
  const [fa, setFa] = useState(fixture.awayScore ?? 0);
  const [pen, setPen] = useState('');
  const [busy, setBusy] = useState(false);

  const koLevel = fixture.knockout && Number(fh) === Number(fa);
  const num = fixture.num;
  const home = fixture.homeTeam?.code || 'Home';
  const away = fixture.awayTeam?.code || 'Away';

  async function pushLive() {
    setBusy(true);
    try { await adminLive(num, { homeGoals: Number(hg), awayGoals: Number(ag), minute: Number(minute), phase }); showToast('Live score pushed'); }
    catch (e) { showToast(e.message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (koLevel && !pen) return showToast('Pick the penalty-shootout winner');
    setBusy(true);
    try {
      await adminResult(num, { homeScore: Number(fh), awayScore: Number(fa), penWinner: koLevel ? pen : undefined });
      showToast('Result confirmed — pools settled');
    } catch (e) { showToast(e.message); } finally { setBusy(false); }
  }

  return (
    <div style="margin-top:12px">
      <p class="muted" style="font-size:.85rem;margin-bottom:8px">Fixture #{num}: {home} v {away}</p>

      <span class="section-label">Live score</span>
      <div class="admin-score">
        <input class="input num" type="number" min="0" value={hg} onInput={(e) => setHg(e.target.value)} />
        <span class="display">–</span>
        <input class="input num" type="number" min="0" value={ag} onInput={(e) => setAg(e.target.value)} />
      </div>
      <div class="admin-grid">
        <div class="field" style="margin:0"><label>Minute</label><input class="input num" type="number" min="0" value={minute} onInput={(e) => setMinute(e.target.value)} /></div>
        <div class="field" style="margin:0"><label>Phase</label>
          <select class="input" value={phase} onChange={(e) => setPhase(e.target.value)}>
            {PHASES.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ').toLowerCase()}</option>)}
          </select>
        </div>
      </div>
      <button class="btn btn-signal btn-block" style="margin-top:10px" disabled={busy} onClick={pushLive}>Push live score</button>

      <div style="height:1px;background:var(--line);margin:18px 0" />

      <span class="section-label">Confirm final result</span>
      <div class="admin-score">
        <input class="input num" type="number" min="0" value={fh} onInput={(e) => setFh(e.target.value)} />
        <span class="display">–</span>
        <input class="input num" type="number" min="0" value={fa} onInput={(e) => setFa(e.target.value)} />
      </div>
      {koLevel ? (
        <div class="field"><label>Penalty-shootout winner</label>
          <select class="input" value={pen} onChange={(e) => setPen(e.target.value)}>
            <option value="">choose…</option>
            <option value={fixture.homeTeam?.code}>{home}</option>
            <option value={fixture.awayTeam?.code}>{away}</option>
          </select>
        </div>
      ) : null}
      <button class="btn btn-primary btn-block" style="margin-top:10px" disabled={busy} onClick={confirm}>Confirm result &amp; settle</button>
      <p class="muted" style="font-size:.78rem;margin-top:10px">Settlement is idempotent — confirming again won’t double-pay.</p>
    </div>
  );
}
