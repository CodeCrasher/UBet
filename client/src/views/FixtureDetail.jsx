import { fixtureView, goFixtures, goPool } from '../lib/store.js';
import { fmtKickoff, money } from '../lib/helpers.js';

export function FixtureDetail() {
  const data = fixtureView.value;
  if (!data) return <div class="empty">Loading…</div>;
  const f = data.fixture;
  const live = f.status === 'live';
  const final = f.status === 'final';

  return (
    <div>
      <button class="back-link" onClick={goFixtures}>← All fixtures</button>

      <div class="fixture-hero">
        <div class="spread" style="margin-bottom:12px">
          <span class="slate-meta">{f.group ? `Group ${f.group}` : f.round}</span>
          <span class={`pill ${f.status}`}>{live ? <><span class="dot" /> Live</> : final ? 'Final' : 'Upcoming'}</span>
        </div>
        <div class="fh-teams">
          <Team t={f.homeTeam} label={f.homeLabel} />
          <div class="fh-score num">
            {live ? `${f.live.homeGoals}–${f.live.awayGoals}` : final ? `${f.homeScore}–${f.awayScore}` : 'vs'}
          </div>
          <Team t={f.awayTeam} label={f.awayLabel} />
        </div>
        <p class="muted center" style="margin-top:12px;font-size:.85rem">
          {final ? 'Full time' : live ? `Live · ${f.live.minute}'` : fmtKickoff(f.kickoff)} · pools lock at kickoff
        </p>
      </div>

      <div class="spread" style="margin:2px 2px 10px">
        <span class="section-label">Pools</span>
        <span class="muted" style="font-size:.8rem">{f.locked ? 'Locked' : 'Open to enter'}</span>
      </div>

      <div class="slips">
        {data.pools.map((p) => (
          <button class="slip" key={p.id} onClick={() => goPool(p.id)}>
            <div>
              <div class="slip-name">{p.name}</div>
              <div class="slip-mech">{p.mechanic}</div>
              <div class="slip-stats">
                <div class="slip-stat"><div class="k">Entry</div><div class="v num">{money(p.fee)}</div></div>
                <div class="slip-stat"><div class="k">Pot</div><div class="v num pot">{money(p.pot)}</div></div>
                <div class="slip-stat"><div class="k">Entrants</div><div class="v num">{p.entrantCount}</div></div>
              </div>
            </div>
            <div class="slip-right">
              {p.entered ? <span class="entered-tag">Entered</span> : null}
              <span class={`pill ${p.status === 'settled' ? 'final' : p.status === 'locked' ? 'live' : 'upcoming'}`}>
                {p.status === 'settled' ? 'Final' : p.status === 'locked' ? 'Locked' : 'Open'}
              </span>
              <span class="btn btn-ghost btn-sm">View →</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Team({ t, label }) {
  return (
    <div class="team-cell">
      <span class="flag" style="font-size:2.2rem">{t ? t.flag : '🏳️'}</span>
      <span class="abbr" style="font-size:1.05rem">{t ? t.code : '—'}</span>
      <span class="full">{t ? t.name : label}</span>
    </div>
  );
}
