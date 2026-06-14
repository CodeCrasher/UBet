import { view, toast } from './lib/store.js';
import { Landing } from './views/Landing.jsx';
import { Pool } from './views/Pool.jsx';
import { PitchBackground } from './components/PitchBackground.jsx';

export function App() {
  return (
    <>
      {view.value === 'pool' ? (
        <Pool />
      ) : (
        <div class="app">
          <PitchBackground />
          <header class="appbar">
            <div class="appbar-inner">
              <div class="brand"><span class="ball">⚽</span><span><span class="u">U</span>Bet</span></div>
              <span class="grow" />
              <span class="muted" style="font-size:.82rem">World Cup 2026</span>
            </div>
          </header>
          <main class="main"><Landing /></main>
        </div>
      )}
      {toast.value ? <div class="toast">{toast.value}</div> : null}
    </>
  );
}
