import { useState, useEffect } from 'preact/hooks';
import { createPool, joinPool, peekPool, showToast, appConfig } from '../lib/store.js';
import { request } from '../lib/api.js';
import { money } from '../lib/helpers.js';

export function Landing() {
  const [mode, setMode] = useState('join');
  return (
    <div class="landing">
      <div class="hero-mark">
        <span class="lg-ball">⚽</span>
        <h1><span class="u">U</span>Bet</h1>
        <p class="tag">Private World Cup 2026 prediction pool.<br />Predict scores. Climb the board. Win the pot.</p>
      </div>
      <div class="seg">
        <button class={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Join a pool</button>
        <button class={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Create a pool</button>
      </div>
      {mode === 'join' ? <JoinForm /> : <CreateForm />}
    </div>
  );
}

function JoinForm() {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = code.trim().toUpperCase();
    if (c.length !== 6) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    peekPool(c).then((p) => !cancelled && setPreview(p)).catch(() => !cancelled && setPreview(null));
    return () => { cancelled = true; };
  }, [code]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await joinPool(code, name);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="card card-pad" onSubmit={submit}>
      {err ? <div class="error-banner">{err}</div> : null}
      <div class="field">
        <label>Room code</label>
        <input class="input code-input" maxLength={6} placeholder="ABC123" value={code}
          onInput={(e) => setCode(e.target.value.toUpperCase())} autoFocus />
        {preview ? <span class="hint" style="color:var(--pitch-600);font-weight:600">✓ {preview.name} · {money(preview.buyIn, preview.currency)} buy-in</span> : null}
      </div>
      <div class="field">
        <label>Your display name</label>
        <input class="input" maxLength={32} placeholder="e.g. Alex" value={name} onInput={(e) => setName(e.target.value)} />
      </div>
      <button class="btn btn-primary btn-block" disabled={busy || code.length !== 6 || !name.trim()}>
        {busy ? 'Joining…' : 'Join pool →'}
      </button>
    </form>
  );
}

function CreateForm() {
  const [form, setForm] = useState({
    name: 'Our World Cup Pool',
    hostName: '',
    buyIn: 20,
    currency: 'USD',
    pin: '',
    manual: false,
    rules: { exact: 5, resultGd: 3, result: 1, knockoutMultiplier: 2 },
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const sync = appConfig.value?.sync;

  useEffect(() => {
    request('/config').then((c) => setForm((f) => ({ ...f, buyIn: c.defaultBuyIn, currency: c.defaultCurrency }))).catch(() => {});
  }, []);

  const up = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const code = await createPool(form);
      showToast(`Pool created — share code ${code}`);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="card card-pad" onSubmit={submit}>
      {err ? <div class="error-banner">{err}</div> : null}
      {sync?.enabled ? (
        <div class="sync-banner">
          <span>🔴</span>
          <span>Live results are on — fixtures &amp; scores sync automatically from <b>{sync.provider}</b>. You won't need to enter results by hand.</span>
        </div>
      ) : null}
      <div class="field">
        <label>Pool name</label>
        <input class="input" value={form.name} onInput={(e) => up('name', e.target.value)} />
      </div>
      <div class="field">
        <label>Your name (host)</label>
        <input class="input" maxLength={32} placeholder="e.g. Maya" value={form.hostName} onInput={(e) => up('hostName', e.target.value)} />
      </div>
      <div class="form-grid2">
        <div class="field">
          <label>Buy-in</label>
          <input class="input" type="number" min="0" value={form.buyIn} onInput={(e) => up('buyIn', e.target.value)} />
        </div>
        <div class="field">
          <label>Currency</label>
          <input class="input" maxLength={4} value={form.currency} onInput={(e) => up('currency', e.target.value.toUpperCase())} />
        </div>
      </div>
      <div class="field">
        <label>Host PIN <span class="hint">(needed to enter results — keep it private)</span></label>
        <input class="input code-input" type="password" inputMode="numeric" placeholder="4+ digits"
          value={form.pin} onInput={(e) => up('pin', e.target.value)} />
      </div>
      <label class="section-title" style="display:block;margin:4px 0 8px">Scoring</label>
      <div class="scoring-preview">
        <div class="sp"><div class="v num">{form.rules.exact}</div><div class="l">Exact score</div></div>
        <div class="sp"><div class="v num">{form.rules.resultGd}</div><div class="l">Result + GD</div></div>
        <div class="sp"><div class="v num">{form.rules.result}</div><div class="l">Result only</div></div>
        <div class="sp"><div class="v num">×{form.rules.knockoutMultiplier}</div><div class="l">KO rounds</div></div>
      </div>
      <p class="hint" style="margin:2px 0 14px">Defaults are sensible — you can fine-tune scoring anytime in settings.</p>
      {sync?.enabled ? (
        <label class="checkbox-row">
          <input type="checkbox" checked={form.manual} onInput={(e) => up('manual', e.target.checked)} />
          Enter results manually instead (ignore the live feed for this pool)
        </label>
      ) : null}
      <button class="btn btn-primary btn-block" disabled={busy || !form.hostName.trim() || form.pin.length < 4}>
        {busy ? 'Creating…' : 'Create pool & get code →'}
      </button>
    </form>
  );
}
