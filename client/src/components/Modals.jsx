import { useState } from 'preact/hooks';
import { poolState, verifyHostPin, updateSettings, showToast } from '../lib/store.js';

export function Modal({ title, sub, onClose, children }) {
  return (
    <div class="modal-scrim" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {sub ? <p class="sub">{sub}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function HostPinModal({ onClose }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const ok = await verifyHostPin(pin);
      if (ok) onClose();
      else setErr('That PIN is incorrect.');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Host controls" sub="Enter the pool PIN to enter results, lock matches and manage buy-ins." onClose={onClose}>
      <form onSubmit={submit}>
        {err ? <div class="error-banner">{err}</div> : null}
        <div class="field">
          <label>Host PIN</label>
          <input class="input code-input" type="password" inputMode="numeric" autoFocus
            value={pin} onInput={(e) => setPin(e.target.value)} placeholder="••••" />
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={busy || pin.length < 4}>Unlock</button>
        </div>
      </form>
    </Modal>
  );
}

export function SettingsModal({ onClose }) {
  const pool = poolState.value.pool;
  const [name, setName] = useState(pool.name);
  const [buyIn, setBuyIn] = useState(pool.buyIn);
  const [currency, setCurrency] = useState(pool.currency);
  const [rules, setRules] = useState({ ...pool.rules });
  const [busy, setBusy] = useState(false);

  function setRule(k, v) {
    setRules((r) => ({ ...r, [k]: v === '' ? '' : Number(v) }));
  }

  async function save() {
    setBusy(true);
    try {
      await updateSettings({ name, buyIn: Number(buyIn), currency, rules });
      showToast('Settings updated');
      onClose();
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  const RULE_FIELDS = [
    ['exact', 'Exact score'],
    ['resultGd', 'Result + GD'],
    ['result', 'Result only'],
    ['knockoutMultiplier', 'KO multiplier'],
  ];

  return (
    <Modal title="Pool settings" sub="Changing scoring recalculates every result instantly." onClose={onClose}>
      <div class="field">
        <label>Pool name</label>
        <input class="input" value={name} onInput={(e) => setName(e.target.value)} />
      </div>
      <div class="form-grid2">
        <div class="field">
          <label>Buy-in</label>
          <input class="input" type="number" min="0" value={buyIn} onInput={(e) => setBuyIn(e.target.value)} />
        </div>
        <div class="field">
          <label>Currency</label>
          <input class="input" value={currency} maxLength={4} onInput={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
      </div>
      <label class="section-title" style="display:block;margin:6px 0 8px">Scoring</label>
      <div class="form-grid2">
        {RULE_FIELDS.map(([k, label]) => (
          <div class="field" key={k}>
            <label>{label}</label>
            <input class="input" type="number" min="0" step={k === 'knockoutMultiplier' ? '0.5' : '1'}
              value={rules[k]} onInput={(e) => setRule(k, e.target.value)} />
          </div>
        ))}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button class="btn btn-primary" disabled={busy} onClick={save}>Save changes</button>
      </div>
    </Modal>
  );
}
