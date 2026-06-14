import { useState } from 'preact/hooks';
import { me, route, toast, earnings, ready, logout, goFixtures } from './lib/store.js';
import { money } from './lib/helpers.js';
import { Auth } from './views/Auth.jsx';
import { Fixtures } from './views/Fixtures.jsx';
import { FixtureDetail } from './views/FixtureDetail.jsx';
import { PoolPage } from './views/PoolPage.jsx';
import { EarningsSheet } from './components/EarningsSheet.jsx';
import { AdminPanel } from './components/AdminPanel.jsx';

export function App() {
  const [sheet, setSheet] = useState(null); // 'earnings' | 'admin' | null

  if (!ready.value) return null;
  if (!me.value) return <Auth />;

  const r = route.value;
  const total = earnings.value.total;

  return (
    <div class="app">
      <header class="appbar">
        <div class="appbar-inner">
          <button class="wordmark" onClick={goFixtures} title="Fixtures">
            <span class="ball">⚽</span><span><span class="u">U</span>Bet</span>
          </button>
          <span class="grow" />
          <button class="balance-chip" onClick={() => setSheet('earnings')} title="Earnings breakdown">
            <span class="lbl">Earnings</span>
            <span class={`val num ${total > 0 ? 'pos' : total < 0 ? 'neg' : ''}`}>{money(total)}</span>
            <span class="chev">▾</span>
          </button>
          <button class="btn btn-ghost btn-sm" onClick={logout}>Log out</button>
        </div>
      </header>

      <main class="main">
        {r.name === 'fixtures' && <Fixtures />}
        {r.name === 'fixture' && <FixtureDetail />}
        {r.name === 'pool' && <PoolPage />}
      </main>

      <button class="admin-fab" title="Admin" onClick={() => setSheet('admin')}>⚙</button>

      {sheet === 'earnings' && <EarningsSheet onClose={() => setSheet(null)} />}
      {sheet === 'admin' && <AdminPanel onClose={() => setSheet(null)} />}
      {toast.value && <div class="toast">{toast.value}</div>}
    </div>
  );
}
