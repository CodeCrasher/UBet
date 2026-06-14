import { useState } from 'preact/hooks';
import {
  poolState, isHost, me,
  createCustomBet, editCustomBet, deleteCustomBet, answerCustomBet, showToast,
} from '../lib/store.js';

export function BetsPanel() {
  const state = poolState.value;
  if (!state) return null;
  return (
    <div class="bets-wrap">
      <ScoringGuide rules={state.pool.rules} />
      <CustomBets />
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
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      await createCustomBet({ question: q.trim(), options: opts.trim(), points: Number(pts) });
      setQ(''); setOpts(''); setPts(5);
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
    <div class={`bet ${settled ? 'settled' : ''}`}>
      <div class="bet-head">
        <div class="bet-q">{bet.question}</div>
        <span class="bet-pts num">{bet.points} pts</span>
      </div>

      {settled ? (
        <div class="bet-result">✓ Winner: <b>{bet.answer}</b>{myAnswer ? (winNorm === myAnswer.toLowerCase() ? ` — you nailed it (+${bet.points})` : ` — you picked ${myAnswer}`) : ''}</div>
      ) : myAnswer ? (
        <div class="bet-myanswer">Your pick: <b>{myAnswer}</b> <span class="faint">· editable until settled</span></div>
      ) : (
        <div class="bet-myanswer faint">No pick yet</div>
      )}

      {/* answer UI (players, while open) */}
      {!settled ? (
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
