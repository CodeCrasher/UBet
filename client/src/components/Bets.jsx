import { useState } from 'preact/hooks';
import {
  poolState, isHost, me, myPreds,
  createCustomBet, editCustomBet, deleteCustomBet, answerCustomBet, showToast,
} from '../lib/store.js';
import { teamMap, fmtKickoff, pointsClass } from '../lib/helpers.js';

export function BetsPanel() {
  const state = poolState.value;
  if (!state) return null;
  return (
    <div class="bets-wrap">
      <MyBets />
      <CustomBets />
      <ScoringGuide rules={state.pool.rules} />
    </div>
  );
}

// Personal summary of everything the current player has wagered.
function MyBets() {
  const state = poolState.value;
  const myId = me.value;
  const [openPicks, setOpenPicks] = useState(false);
  if (!myId) return null;
  const myRow = state.leaderboard.find((r) => r.playerId === myId);
  const tmap = teamMap(state);

  const matchByNum = new Map(state.matches.map((m) => [m.num, m]));
  const entries = Object.entries(myPreds.value)
    .map(([num, p]) => ({ num: Number(num), p, match: matchByNum.get(Number(num)) }))
    .filter((x) => x.match);
  const scored = entries.filter((x) => x.match.status === 'final').sort((a, b) => b.p.points - a.p.points);
  const pending = entries.filter((x) => x.match.status !== 'final').length;

  const myCustom = (state.customBets || []).map((b) => ({ b, mine: b.answers.find((a) => a.playerId === myId)?.answer || null }));
  const answered = myCustom.filter((x) => x.mine);
  const openUnanswered = myCustom.filter((x) => !x.mine && x.b.status === 'open').length;
  const customWon = myCustom.filter((x) => x.b.status === 'settled' && x.mine && x.mine.toLowerCase() === String(x.b.answer).toLowerCase()).length;

  const total = myRow?.points ?? 0;
  const matchPts = myRow?.matchPoints ?? 0;
  const customPts = myRow?.customPoints ?? 0;

  return (
    <div class="card card-pad mybets">
      <div class="spread" style="margin-bottom:12px">
        <span class="section-title">Your card</span>
        {myRow ? <span class="rank-chip">#{myRow.rank}</span> : null}
      </div>
      <div class="mb-total">
        <span class="mb-pts num">{total}</span>
        <div class="mb-split">
          <span>pts total</span>
          <span class="faint">{matchPts} matches · {customPts} bets</span>
        </div>
      </div>
      <div class="mb-stats">
        <div class="mb-stat"><span class="num">{entries.length}</span><label>picks made</label></div>
        <div class="mb-stat"><span class="num">{myRow?.exact ?? 0}</span><label>exact hits</label></div>
        <div class="mb-stat"><span class="num">{answered.length}</span><label>bets placed</label></div>
        <div class="mb-stat"><span class="num">{customWon}</span><label>bets won</label></div>
      </div>

      {scored.length ? (
        <>
          <button class="picks-toggle" onClick={() => setOpenPicks(!openPicks)}>
            <span>📊 {scored.length} scored pick{scored.length === 1 ? '' : 's'}{pending ? ` · ${pending} pending` : ''}</span>
            <span class="chev">{openPicks ? 'Hide' : 'Show'}</span>
          </button>
          {openPicks ? (
            <div class="picks-list">
              {scored.map(({ num, p, match }) => (
                <div class="pick-row" key={num}>
                  <span class="pk-name">{tmap.get(match.home)?.code || match.homeLabel} {match.homeScore}-{match.awayScore} {tmap.get(match.away)?.code || match.awayLabel}</span>
                  <span class="pk-score num">{p.home}–{p.away}</span>
                  <span class={`pts-badge ${pointsClass(p.points)}`}>{p.points > 0 ? `+${p.points}` : '0'}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p class="note-line faint" style="margin:0">No scored picks yet — make predictions in the Matches tab.</p>
      )}

      {answered.length ? (
        <div class="mb-custom">
          {answered.map(({ b, mine }) => {
            const won = b.status === 'settled' && mine.toLowerCase() === String(b.answer).toLowerCase();
            const lost = b.status === 'settled' && !won;
            return (
              <div class="mb-bet" key={b.id}>
                <span class="mb-bet-q">{b.question}</span>
                <span class="mb-bet-a">{mine}</span>
                {won ? <span class="pts-badge s5">+{b.points}</span>
                  : lost ? <span class="pts-badge s0">0</span>
                    : b.status === 'locked' ? <span class="mb-bet-tag locked">🔒</span>
                      : <span class="mb-bet-tag open">open</span>}
              </div>
            );
          })}
        </div>
      ) : null}
      {openUnanswered ? <p class="note-line" style="margin-top:10px">🎲 {openUnanswered} open bet{openUnanswered === 1 ? '' : 's'} you haven’t picked yet — scroll down.</p> : null}
    </div>
  );
}

// The points-calculation reference.
function ScoringGuide({ rules }) {
  const rows = [
    ['Exact scoreline', `+${rules.exact}`, 'You nail the exact result'],
    ['Correct result', `+${rules.result}`, 'Win / draw / loss is right'],
    ['Goal difference', `+${rules.goalDiff}`, 'Right margin (when not exact)'],
    ['Over / Under 2.5', `+${rules.overUnder}`, 'Right side of 2.5 total goals'],
    ['Custom bets', 'host-set', 'Prop bets below, points per bet'],
    ['Knockout rounds', `×${rules.knockoutMultiplier}`, 'Multiplies the match points'],
  ];
  return (
    <div class="card card-pad">
      <div class="spread" style="margin-bottom:10px">
        <span class="section-title">How points are calculated</span>
      </div>
      <p class="note-line">Each match scores <b>additively</b> from your one scoreline pick — markets stack.</p>
      <div class="score-rows">
        {rows.map(([label, val, desc]) => (
          <div class="score-row" key={label}>
            <span class="sr-val num">{val}</span>
            <div class="sr-body">
              <div class="sr-label">{label}</div>
              <div class="sr-desc">{desc}</div>
            </div>
          </div>
        ))}
      </div>
      <p class="note-line faint" style="margin-top:10px">
        A perfect group-stage pick = {rules.exact + rules.result + rules.overUnder} pts
        (exact {rules.exact} + result {rules.result} + O/U {rules.overUnder}).
        Ties break on exact scores, then custom points, then correct results.
      </p>
    </div>
  );
}

function CustomBets() {
  const state = poolState.value;
  const host = isHost.value;
  const bets = state.customBets || [];
  return (
    <div class="card card-pad">
      <div class="spread" style="margin-bottom:10px">
        <span class="section-title">Custom bets</span>
        <span class="faint" style="font-size:.78rem">{bets.length} bet{bets.length === 1 ? '' : 's'}</span>
      </div>
      {host ? <NewBet /> : null}
      {bets.length === 0 ? (
        <div class="empty"><div class="em-ic">🎲</div><p>{host ? 'Add a prop bet above' : 'No custom bets yet'}</p></div>
      ) : (
        <div class="bet-list">{bets.map((b) => <BetCard key={b.id} bet={b} />)}</div>
      )}
    </div>
  );
}

function NewBet() {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState('');
  const [pts, setPts] = useState(5);
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      // datetime-local is local time → send as ISO so the server stores UTC
      const locksAt = deadline ? new Date(deadline).toISOString() : null;
      await createCustomBet({ question: q.trim(), options: opts.trim(), points: Number(pts), locksAt });
      setQ(''); setOpts(''); setPts(5); setDeadline('');
    } catch (e2) {
      showToast(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="new-bet" onSubmit={add}>
      <input class="input" placeholder="Bet question — e.g. Golden Boot winner?" value={q} onInput={(e) => setQ(e.target.value)} />
      <div class="new-bet-row">
        <input class="input" placeholder="Options, comma-separated (blank = free text)" value={opts} onInput={(e) => setOpts(e.target.value)} />
        <input class="input pts-in" type="number" min="0" max="50" value={pts} onInput={(e) => setPts(e.target.value)} title="Points" />
      </div>
      <label class="deadline-field">
        <span>Closes (optional)</span>
        <input class="input" type="datetime-local" value={deadline} onInput={(e) => setDeadline(e.target.value)} />
      </label>
      <button class="btn btn-gold btn-sm" disabled={busy || !q.trim()}>＋ Add bet</button>
    </form>
  );
}

function BetCard({ bet }) {
  const state = poolState.value;
  const host = isHost.value;
  const myId = me.value;
  const nameById = new Map((state.players || []).map((p) => [p.id, p.name]));
  const myAnswer = bet.answers.find((a) => a.playerId === myId)?.answer || null;
  const settled = bet.status === 'settled';
  const locked = bet.status === 'locked';
  const open = bet.status === 'open';
  const winNorm = settled ? String(bet.answer).trim().toLowerCase() : null;
  const [freeText, setFreeText] = useState('');

  async function pick(answer) {
    try {
      await answerCustomBet(bet.id, answer);
    } catch (e) {
      showToast(e.message);
    }
  }
  async function settle(answer) {
    if (!answer) return;
    try {
      await editCustomBet(bet.id, { answer });
    } catch (e) {
      showToast(e.message);
    }
  }
  async function reopen() {
    try { await editCustomBet(bet.id, { answer: null }); } catch (e) { showToast(e.message); }
  }
  async function remove() {
    if (!confirm('Delete this bet?')) return;
    try { await deleteCustomBet(bet.id); } catch (e) { showToast(e.message); }
  }

  // tally answers
  const tally = new Map();
  for (const a of bet.answers) tally.set(a.answer, (tally.get(a.answer) || 0) + 1);

  return (
    <div class={`bet ${settled ? 'settled' : ''} ${locked ? 'locked' : ''}`}>
      <div class="bet-head">
        <div class="bet-q">{bet.question}</div>
        <span class="bet-pts num">{bet.points} pts</span>
      </div>

      {settled ? (
        <div class="bet-result">✓ Winner: <b>{bet.answer}</b>{myAnswer ? (winNorm === myAnswer.toLowerCase() ? ` — you nailed it (+${bet.points})` : ` — you picked ${myAnswer}`) : ''}</div>
      ) : locked ? (
        <div class="bet-myanswer">🔒 Betting closed — awaiting result.{myAnswer ? <> Your pick: <b>{myAnswer}</b>.</> : ' You didn’t pick.'}</div>
      ) : myAnswer ? (
        <div class="bet-myanswer">Your pick: <b>{myAnswer}</b> <span class="faint">· editable until it closes</span></div>
      ) : (
        <div class="bet-myanswer faint">No pick yet</div>
      )}
      {bet.locksAt && !settled ? (
        <div class="bet-deadline">{locked ? '🔒 Closed' : '⏳ Closes'} {fmtKickoff(bet.locksAt)}</div>
      ) : null}

      {/* answer UI (players, while open) */}
      {open ? (
        bet.options ? (
          <div class="opt-row">
            {bet.options.map((o) => (
              <button key={o} class={`opt ${myAnswer && myAnswer.toLowerCase() === o.toLowerCase() ? 'on' : ''}`} onClick={() => pick(o)}>{o}</button>
            ))}
          </div>
        ) : (
          <form class="opt-free" onSubmit={(e) => { e.preventDefault(); if (freeText.trim()) { pick(freeText.trim()); setFreeText(''); } }}>
            <input class="input" placeholder={myAnswer ? 'Change your answer…' : 'Type your answer…'} value={freeText} onInput={(e) => setFreeText(e.target.value)} />
            <button class="btn btn-ghost btn-sm">Save</button>
          </form>
        )
      ) : null}

      {/* everyone's answers (fully open) */}
      {bet.answers.length ? (
        <div class="bet-answers">
          {[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([ans, n]) => (
            <span key={ans} class={`ans-chip ${settled && ans.toLowerCase() === winNorm ? 'win' : ''}`}>{ans} · {n}</span>
          ))}
        </div>
      ) : null}
      <div class="bet-voters faint">
        {bet.answers.map((a) => `${nameById.get(a.playerId) || '?'}: ${a.answer}`).join('  ·  ') || 'No answers yet'}
      </div>

      {/* host controls */}
      {host ? (
        <div class="bet-host">
          {settled ? (
            <button class="btn btn-ghost btn-sm" onClick={reopen}>Re-open</button>
          ) : bet.options ? (
            <div class="settle-row">
              <span class="faint" style="font-size:.76rem">Settle winner:</span>
              {bet.options.map((o) => <button key={o} class="opt settle" onClick={() => settle(o)}>{o}</button>)}
            </div>
          ) : (
            <SettleFree onSettle={settle} />
          )}
          <button class="btn-icon del" title="Delete bet" onClick={remove}>🗑</button>
        </div>
      ) : null}
    </div>
  );
}

function SettleFree({ onSettle }) {
  const [v, setV] = useState('');
  return (
    <form class="settle-free" onSubmit={(e) => { e.preventDefault(); onSettle(v.trim()); }}>
      <input class="input" placeholder="Winning answer…" value={v} onInput={(e) => setV(e.target.value)} />
      <button class="btn btn-gold btn-sm" disabled={!v.trim()}>Settle</button>
    </form>
  );
}
