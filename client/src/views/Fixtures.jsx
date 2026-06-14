import { useState } from 'preact/hooks';
import { fixtures, goFixture } from '../lib/store.js';
import { fmtKickoff } from '../lib/helpers.js';

const ROUNDS = [
  { key: 'md1', label: 'Matchday 1', test: (f) => f.stage === 'group' && f.matchday === 1 },
  { key: 'md2', label: 'Matchday 2', test: (f) => f.stage === 'group' && f.matchday === 2 },
  { key: 'md3', label: 'Matchday 3', test: (f) => f.stage === 'group' && f.matchday === 3 },
  { key: 'R32', label: 'Round of 32', test: (f) => f.stage === 'R32' },
  { key: 'R16', label: 'Round of 16', test: (f) => f.stage === 'R16' },
  { key: 'QF', label: 'Quarter-finals', test: (f) => f.stage === 'QF' },
  { key: 'SF', label: 'Semi-finals', test: (f) => f.stage === 'SF' },
  { key: 'TP', label: '3rd place', test: (f) => f.stage === 'TP' },
  { key: 'F', label: 'Final', test: (f) => f.stage === 'F' },
];

function defaultKey(list) {
  for (const r of ROUNDS) {
    const ms = list.filter(r.test);
    if (ms.length && ms.some((f) => f.status !== 'final')) return r.key;
  }
  return 'md1';
}

export function Fixtures() {
  const list = fixtures.value;
  const [round, setRound] = useState(null);
  const activeKey = round || defaultKey(list);
  const def = ROUNDS.find((r) => r.key === activeKey) || ROUNDS[0];
  const shown = list.filter(def.test).sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.num - b.num);

  return (
    <div>
      <div class="spread" style="margin:4px 2px 14px">
        <h1 style="font-size:1.5rem">Fixtures</h1>
        <span class="section-label">World Cup 2026</span>
      </div>
      <div class="round-chips">
        {ROUNDS.map((r) => {
          const ms = list.filter(r.test);
          if (!ms.length) return null;
          return (
            <button key={r.key} class={`chip ${r.key === activeKey ? 'active' : ''}`} onClick={() => setRound(r.key)}>
              {r.label}
            </button>
          );
        })}
      </div>

      <div class="slates">
        {shown.map((f) => <Slate key={f.num} f={f} />)}
      </div>
    </div>
  );
}

function Slate({ f }) {
  const live = f.status === 'live';
  const final = f.status === 'final';
  return (
    <button class={`slate ${live ? 'is-live' : ''}`} onClick={() => goFixture(f.num)}>
      <div class="slate-top">
        <span class="slate-meta">{f.group ? `Group ${f.group}` : f.round}</span>
        <span class={`pill ${f.status}`}>{live ? <><span class="dot" /> Live</> : final ? 'Final' : 'Upcoming'}</span>
      </div>
      <div class="slate-teams">
        <TeamCell t={f.homeTeam} label={f.homeLabel} />
        <div class="slate-mid">
          {live ? (
            <div class="score num"><span class="live">{f.live.homeGoals}–{f.live.awayGoals}</span></div>
          ) : final ? (
            <div class="score num">{f.homeScore}–{f.awayScore}</div>
          ) : (
            <div class="vs">vs</div>
          )}
        </div>
        <TeamCell t={f.awayTeam} label={f.awayLabel} />
      </div>
      <div class="slate-foot">
        <span>{final ? 'Full time' : live ? `${f.live.minute}'` : fmtKickoff(f.kickoff)}</span>
        <span><b class="num">{f.entrants}</b> in 5 pools</span>
      </div>
    </button>
  );
}

function TeamCell({ t, label }) {
  return (
    <div class="team-cell">
      <span class="flag">{t ? t.flag : '🏳️'}</span>
      <span class="abbr">{t ? t.code : '—'}</span>
      <span class="full">{t ? t.name : label}</span>
    </div>
  );
}
