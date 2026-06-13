import { useState } from 'preact/hooks';
import { poolState, connected, isHost, session, leavePool, showToast } from '../lib/store.js';
import { Pot, Contributors } from '../components/Pot.jsx';
import { Leaderboard } from '../components/Leaderboard.jsx';
import { Matches } from '../components/Matches.jsx';
import { HostPinModal, SettingsModal } from '../components/Modals.jsx';

export function Pool() {
  const state = poolState.value;
  const [tab, setTab] = useState('matches');
  const [modal, setModal] = useState(null);
  const host = isHost.value;

  if (!state) return <LoadingPool />;

  function copyCode() {
    const code = session.value.code;
    navigator.clipboard?.writeText(code).then(
      () => showToast(`Copied ${code} to clipboard`),
      () => showToast(`Room code: ${code}`),
    );
  }

  return (
    <div class="app">
      <header class="appbar">
        <div class="appbar-inner">
          <div class="brand"><span class="ball">⚽</span><span><span class="u">U</span>Bet</span></div>
          <button class="codebox" onClick={copyCode} title="Copy room code">
            <span class="label">Code</span>
            <span class="code">{state.pool.code}</span>
            <span aria-hidden>📋</span>
          </button>
          <span class="grow" />
          <span class={`conn-dot ${connected.value ? 'on' : ''}`} title={connected.value ? 'Live' : 'Reconnecting…'} />
          {host ? (
            <button class="btn-icon" title="Pool settings" onClick={() => setModal('settings')}>⚙️</button>
          ) : (
            <button class="btn btn-ghost btn-sm" onClick={() => setModal('pin')}>🔑 Host</button>
          )}
          <button class="btn-icon" title="Leave pool" onClick={() => { if (confirm('Leave this pool on this device?')) leavePool(); }}>↩︎</button>
        </div>
      </header>

      <main class="main">
        <div class="spread" style="margin-bottom:14px">
          <div>
            <h1 style="font-size:1.45rem">{state.pool.name}</h1>
            <p class="muted" style="font-size:.86rem">
              {state.players.length} player{state.players.length === 1 ? '' : 's'} ·
              {' '}{state.pool.status === 'finished' ? ' 🏁 Finished' : ' In play'}
              {host ? ' · 🛠 Host mode' : ''}
            </p>
          </div>
        </div>

        {/* Pot is the hero — always visible */}
        <div style="margin-bottom:16px"><Pot /></div>

        {/* Mobile tabs */}
        <div class="tabs">
          <button class={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}>Matches</button>
          <button class={tab === 'table' ? 'active' : ''} onClick={() => setTab('table')}>Table</button>
          <button class={tab === 'pays' ? 'active' : ''} onClick={() => setTab('pays')}>Buy-ins</button>
        </div>

        <div class="pool-grid">
          <div data-mtab class={tab === 'matches' ? 'active-tab' : ''}>
            <Matches />
          </div>
          <div class="rail">
            <div data-mtab class={tab === 'table' ? 'active-tab' : ''}><Leaderboard /></div>
            <div data-mtab class={tab === 'pays' ? 'active-tab' : ''}><Contributors /></div>
          </div>
        </div>
      </main>

      {modal === 'pin' ? <HostPinModal onClose={() => setModal(null)} /> : null}
      {modal === 'settings' ? <SettingsModal onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function LoadingPool() {
  return (
    <div class="app">
      <header class="appbar"><div class="appbar-inner"><div class="brand"><span class="ball">⚽</span><span><span class="u">U</span>Bet</span></div></div></header>
      <main class="main">
        <div class="skeleton" style="height:170px;margin-bottom:16px" />
        <div class="skeleton" style="height:54px;margin-bottom:12px" />
        <div class="skeleton" style="height:120px;margin-bottom:12px" />
        <div class="skeleton" style="height:120px" />
      </main>
    </div>
  );
}
