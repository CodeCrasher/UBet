import { useState } from 'preact/hooks';
import { authSubmit } from '../lib/store.js';
import { PitchBackground } from '../components/PitchBackground.jsx';

export function Auth() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await authSubmit(mode, form);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="app">
      <PitchBackground />
      <div class="auth">
        <div class="auth-mark">
          <span class="ball">⚽</span>
          <h1><span class="u">U</span>Bet</h1>
          <p class="tag">Live World Cup 2026 prediction board.<br />Enter pools, watch the board swing, win the pot.</p>
        </div>

        <div class="seg">
          <button class={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
          <button class={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Sign up</button>
        </div>

        <form class="card card-pad" onSubmit={submit}>
          {err ? <div class="error-banner">{err}</div> : null}
          {mode === 'register' ? (
            <div class="field">
              <label>Display name</label>
              <input class="input" value={form.displayName} maxLength={32} placeholder="e.g. Alex" onInput={(e) => up('displayName', e.target.value)} />
            </div>
          ) : null}
          <div class="field">
            <label>Email</label>
            <input class="input" type="email" autocomplete="email" value={form.email} placeholder="you@example.com" onInput={(e) => up('email', e.target.value)} />
          </div>
          <div class="field">
            <label>Password</label>
            <input class="input" type="password" autocomplete={mode === 'register' ? 'new-password' : 'current-password'} value={form.password} placeholder="••••••••" onInput={(e) => up('password', e.target.value)} />
          </div>
          <button class="btn btn-primary btn-block" disabled={busy || !form.email || !form.password}>
            {busy ? 'One sec…' : mode === 'register' ? 'Create account' : 'Log in'}
          </button>
          <p class="muted center" style="font-size:.8rem;margin-top:12px">Every account starts with virtual Rs. No real money — ever.</p>
        </form>
      </div>
    </div>
  );
}
