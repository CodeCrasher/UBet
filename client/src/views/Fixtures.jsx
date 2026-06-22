import { useState } from 'preact/hooks';
import { fixtures, goFixture } from '../lib/store.js';
import { fmtKickoff } from '../lib/helpers.js';

const ROUNDS = [
  { key: 'groups', label: 'Groups', test: null },
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
  const now = Date.now();
  // Prefer rounds with genuinely future kickoffs first
  for (const r of ROUNDS) {
    if (!r.test) continue;
    const ms = list.filter(r.test);
    if (ms.length && ms.some((f) => f.status !== 'final' && new Date(f.kickoff).getTime() > now)) return r.key;
  }
  // Fallback: first round with any unresolved match
  for (const r of ROUNDS) {
    if (!r.test) continue;
    const ms = list.filter(r.test);
    if (ms.length && ms.some((f) => f.status !== 'final')) return r.key;
  }
  return 'md1';
}

function buildGroups(list) {
  const groups = {};
  for (const f of list) {
    if (f.stage !== 'group' || !f.group) continue;
    if (!groups[f.group]) groups[f.group] = new Map();
    if (f.homeTeam?.code) groups[f.group].set(f.homeTeam.code, f.homeTeam);
    if (f.awayTeam?.code) groups[f.group].set(f.awayTeam.code, f.awayTeam);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, teamsMap]) => ({ letter, teams: [...teamsMap.values()] }));
}

export function Fixtures() {
  const list = fixtures.value;
  const [round, setRound] = useState(null);
  const activeKey = round || defaultKey(list);
  const def = ROUNDS.find((r) => r.key === activeKey);
  const shown = def?.test ? list.filter(def.test).sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.num - b.num) : [];

  return (
    <div>
      <div class="spread" style="margin:4px 2px 14px">
        <h1 style="font-size:1.5rem">Fixtures</h1>
        <span class="section-label">World Cup 2026</span>
      </div>
      <div class="round-chips">
        {ROUNDS.map((r) => {
          if (r.test && !list.filter(r.test).length) return null;
          return (
            <button key={r.key} class={`chip ${r.key === activeKey ? 'active' : ''}`} onClick={() => setRound(r.key)}>
              {r.label}
            </button>
          );
        })}
      </div>

      {activeKey === 'groups' ? (
        <GroupsGrid groups={buildGroups(list)} />
      ) : (
        <div class="slates">
          {shown.map((f) => <Slate key={f.num} f={f} />)}
        </div>
      )}
    </div>
  );
}

function GroupsGrid({ groups }) {
  if (!groups.length) return <p class="muted center" style="padding:40px 0">Loading groups…</p>;
  return (
    <div class="groups-grid">
      {groups.map(({ letter, teams }) => (
        <div key={letter} class="group-card card">
          <div class="group-card-hd">Group {letter}</div>
          {teams.map((t) => (
            <div key={t.code} class="group-team-row">
              <span class="group-team-flag">{t.flag}</span>
              <span class="group-team-code">{t.code}</span>
              <span class="group-team-name">{t.name}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Slate({ f }) {
  const live = f.status === 'live';
  const final = f.status === 'final';
  const past = !live && !final && Date.now() >= new Date(f.kickoff).getTime();
  const pillClass = live ? 'live' : final ? 'final' : past ? 'past' : 'upcoming';
  return (
    <button class={`slate ${live ? 'is-live' : ''}`} onClick={() => goFixture(f.num)}>
      <div class="slate-top">
        <span class="slate-meta">{f.group ? `Group ${f.group}` : f.round}</span>
        <span class={`pill ${pillClass}`}>
          {live ? <><span class="dot" /> Live</> : final ? 'Final' : past ? 'Awaiting result' : 'Upcoming'}
        </span>
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
        <span>{final ? 'Full time' : live ? `${f.live.minute}'` : past ? 'Result pending' : fmtKickoff(f.kickoff)}</span>
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
