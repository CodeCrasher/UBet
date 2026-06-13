import { useLayoutEffect, useRef } from 'preact/hooks';
import { poolState, me } from '../lib/store.js';
import { initials, colorFor } from '../lib/helpers.js';

// FLIP: animate rows sliding to their new position whenever the order changes.
export function Leaderboard() {
  const state = poolState.value;
  const containerRef = useRef(null);
  const posRef = useRef(new Map());
  const myId = me.value;
  const rows = state?.leaderboard || [];

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nodes = el.querySelectorAll('[data-pid]');
    nodes.forEach((node) => {
      const pid = node.dataset.pid;
      const newTop = node.offsetTop;
      const oldTop = posRef.current.get(pid);
      if (oldTop != null && oldTop !== newTop && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        node.animate(
          [{ transform: `translateY(${oldTop - newTop}px)` }, { transform: 'translateY(0)' }],
          { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      }
      posRef.current.set(pid, newTop);
    });
  });

  return (
    <div class="card card-pad">
      <div class="spread" style="margin-bottom:6px">
        <span class="section-title">Leaderboard</span>
        <span class="faint" style="font-size:.78rem">live</span>
      </div>
      {rows.length === 0 ? (
        <div class="empty"><div class="em-ic">📋</div><p>No players yet</p></div>
      ) : (
        <div class="lb-list" ref={containerRef}>
          {rows.map((r) => (
            <div
              key={r.playerId}
              data-pid={r.playerId}
              class={`lb-row r${r.rank} ${r.playerId === myId ? 'me' : ''}`}
            >
              <div class="lb-rank num">{r.rank}</div>
              <div class="lb-name">
                <span class="av" style={{ background: colorFor(r.playerId), width: '26px', height: '26px', borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontSize: '.72rem', fontWeight: 700, flex: '0 0 auto' }}>
                  {initials(r.name)}
                </span>
                <span class="nm">{r.name}</span>
                {r.playerId === myId ? <span class="youtag">YOU</span> : null}
              </div>
              <div class="lb-pts">
                <div class="p num">{r.points}</div>
                <div class="lbl">{r.exact} exact</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
