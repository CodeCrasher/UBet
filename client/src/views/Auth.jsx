import { useState, useEffect } from 'preact/hooks';
import { authSubmit, forgotPassword, resetPassword, showToast, navigate } from '../lib/store.js';
import { PitchBackground } from '../components/PitchBackground.jsx';

export function Auth({ resetToken = null }) {
  const [mode, setMode] = useState(resetToken ? 'reset' : 'login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '', newPassword: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetLink, setResetLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const up = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (resetToken) { setMode('reset'); setErr(''); }
  }, [resetToken]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const token = await forgotPassword(form.email);
        const link = `${location.origin}${location.pathname}#/reset/${token}`;
        setResetLink(link);
      } else if (mode === 'reset') {
        await resetPassword(resetToken, form.newPassword);
        showToast('Password updated — please log in');
        navigate('#/');
        setMode('login');
        setForm((f) => ({ ...f, newPassword: '' }));
      } else {
        await authSubmit(mode, form);
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(resetLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }

  function goBack() {
    setMode('login');
    setErr('');
    setResetLink(null);
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

        {mode !== 'forgot' && mode !== 'reset' && (
          <div class="seg">
            <button class={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setErr(''); }}>Log in</button>
            <button class={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setErr(''); }}>Sign up</button>
          </div>
        )}

        <form class="card card-pad" onSubmit={submit}>
          {err ? <div class="error-banner">{err}</div> : null}

          {/* ── Forgot password ── */}
          {mode === 'forgot' && !resetLink && (
            <>
              <p style="font-size:.9rem;font-weight:700;margin-bottom:14px">Forgot password</p>
              <p class="muted" style="font-size:.85rem;margin-bottom:16px">Enter your email and we'll generate a reset link you can use right away.</p>
              <div class="field">
                <label>Email</label>
                <input class="input" type="email" autocomplete="email" value={form.email} placeholder="you@example.com" onInput={(e) => up('email', e.target.value)} />
              </div>
              <button class="btn btn-primary btn-block" disabled={busy || !form.email}>
                {busy ? 'Generating…' : 'Get reset link'}
              </button>
              <p class="center" style="margin-top:14px">
                <button type="button" class="link-btn" onClick={goBack}>← Back to log in</button>
              </p>
            </>
          )}

          {/* ── Reset link result ── */}
          {mode === 'forgot' && resetLink && (
            <>
              <div class="success-banner">Reset link generated — valid for 1 hour.</div>
              <p class="muted" style="font-size:.85rem;margin-bottom:12px">Click the link below or copy it to share:</p>
              <div class="reset-link-box">
                <a href={resetLink} class="reset-link-text" onClick={(e) => { e.preventDefault(); navigate(`#/reset/${resetLink.split('/reset/')[1]}`); }}>
                  Open reset form →
                </a>
                <button type="button" class="btn btn-ghost btn-sm" onClick={copyLink} style="flex-shrink:0">
                  {copied ? '✓ Copied' : 'Copy link'}
                </button>
              </div>
              <p class="center" style="margin-top:14px">
                <button type="button" class="link-btn" onClick={goBack}>← Back to log in</button>
              </p>
            </>
          )}

          {/* ── Reset password ── */}
          {mode === 'reset' && (
            <>
              <p style="font-size:.9rem;font-weight:700;margin-bottom:14px">Choose a new password</p>
              <div class="field">
                <label>New password</label>
                <input class="input" type="password" autocomplete="new-password" value={form.newPassword} placeholder="At least 6 characters" onInput={(e) => up('newPassword', e.target.value)} />
              </div>
              <button class="btn btn-primary btn-block" disabled={busy || !form.newPassword || form.newPassword.length < 6}>
                {busy ? 'Updating…' : 'Update password'}
              </button>
            </>
          )}

          {/* ── Login ── */}
          {mode === 'login' && (
            <>
              <div class="field">
                <label>Email</label>
                <input class="input" type="email" autocomplete="email" value={form.email} placeholder="you@example.com" onInput={(e) => up('email', e.target.value)} />
              </div>
              <div class="field">
                <label>Password</label>
                <input class="input" type="password" autocomplete="current-password" value={form.password} placeholder="••••••••" onInput={(e) => up('password', e.target.value)} />
              </div>
              <button class="btn btn-primary btn-block" disabled={busy || !form.email || !form.password}>
                {busy ? 'One sec…' : 'Log in'}
              </button>
              <p class="center" style="margin-top:12px">
                <button type="button" class="link-btn" onClick={() => { setMode('forgot'); setErr(''); setResetLink(null); }}>
                  Forgot password?
                </button>
              </p>
            </>
          )}

          {/* ── Register ── */}
          {mode === 'register' && (
            <>
              <div class="field">
                <label>Display name</label>
                <input class="input" value={form.displayName} maxLength={32} placeholder="e.g. Alex" onInput={(e) => up('displayName', e.target.value)} />
              </div>
              <div class="field">
                <label>Email</label>
                <input class="input" type="email" autocomplete="email" value={form.email} placeholder="you@example.com" onInput={(e) => up('email', e.target.value)} />
              </div>
              <div class="field">
                <label>Password</label>
                <input class="input" type="password" autocomplete="new-password" value={form.password} placeholder="••••••••" onInput={(e) => up('password', e.target.value)} />
              </div>
              <button class="btn btn-primary btn-block" disabled={busy || !form.email || !form.password}>
                {busy ? 'One sec…' : 'Create account'}
              </button>
            </>
          )}

          {mode === 'register' && (
            <p class="muted center" style="font-size:.8rem;margin-top:12px">Every account starts with virtual Rs. No real money — ever.</p>
          )}
        </form>
      </div>
    </div>
  );
}
