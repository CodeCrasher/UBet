import { useEffect, useRef, useState } from 'preact/hooks';
import {
  poolState, myPreds, isHost, me,
  predict, enterResult, clearResult, toggleLock, showToast,
} from '../lib/store.js';
import {
  teamMap, fmtKickoff, ROUND_ORDER, defaultRoundKey, pointsClass,
} from '../lib/helpers.js';

export function Matches() {
  const state = poolState.value;
  const matches = state?.matches || [];
  const [round, setRound] = useState(null);

  // pick a sensible default round once matches load
  useEffect(() => {
    if (round === null && matches.length) setRound(defaultRoundKey(matches));
  }, [matches.length]);

  const activeKey = round || (matches.length ? defaultRoundKey(matches) : ROUND_ORDER[0].key);
  const def = ROUND_ORDER.find((r) => r.key === activeKey) || ROUND_ORDER[0];
  const list = matches.filter(def.test).sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.num - b.num);
  const tmap = teamMap(state);

  return (
    <div class="tabpanel">
      <div class="round-chips" role="tablist">
        {ROUND_ORDER.map((r) => {
          const ms = matches.filter(r.test);
          if (!ms.length) return null;
          const done = ms.filter((m) => m.status === 'final').length;
          return (
            <button
              key={r.key}
              class={`chip ${r.key === activeKey ? 'active' : ''}`}
              onClick={() => setRound(r.key)}
            >
              {r.label}{done ? ` · ${done}/${ms.length}` : ''}
            </button>
          );
        })}
      </div>

      <div class="match-list">
        {list.length === 0 ? (
          <div class="empty"><div class="em-ic">⚽</div><p>No fixtures here yet</p></div>
        ) : (
          list.map((m) => <MatchCard key={m.num} match={m} tmap={tmap} />)
        )}
      </div>
    </div>
  );
}

function Team({ code, label, flag, align }) {
  if (code) {
    return (
      <div class={`team ${align}`}>
        <span class="flag">{flag || '⚽'}</span>
        <span class="tname">{label}</span>
      </div>
    );
  }
  return (
    <div class={`team ${align}`}>
      <span class="flag">🏳️</span>
      <span class="tname tbd">{label || 'TBD'}</span>
    </div>
  );
}

function MatchCard({ match, tmap }) {
  const host = isHost.value;
  const synced = poolState.value?.pool?.synced;
  const myPred = myPreds.value[match.num];
  const home = match.home ? tmap.get(match.home) : null;
  const away = match.away ? tmap.get(match.away) : null;
  const isFinal = match.status === 'final';
  const isLive = match.status === 'live';
  const resolved = match.home && match.away;

  return (
    <article class={`match ${isFinal ? 'is-final' : ''} ${isLive ? 'is-live' : ''}`}>
      <div class="match-top">
        <div class="match-meta">
          {match.group ? <span class="group-tag">Group {match.group}</span> : <span class="group-tag">{match.round}</span>}
          <span>{isFinal ? 'Full time' : fmtKickoff(match.kickoff)}</span>
        </div>
        <span class={`pill ${match.status}`}>{match.status === 'live' ? 'Live' : match.status === 'final' ? 'Final' : 'Upcoming'}</span>
      </div>

      <div class="teams">
        <Team code={match.home} label={home ? home.name : match.homeLabel} flag={home?.flag} align="home" />
        {isFinal ? (
          <div class="score-final">
            <span class="sc num">{match.homeScore}</span>
            <span class="dash">–</span>
            <span class="sc num">{match.awayScore}</span>
          </div>
        ) : (
          <span class="vs">vs</span>
        )}
        <Team code={match.away} label={away ? away.name : match.awayLabel} flag={away?.flag} align="away" />
      </div>
      {isFinal && match.penWinner ? (
        <div class="pen-note">{tmap.get(match.penWinner)?.name} win on penalties</div>
      ) : null}

      {/* prediction area */}
      {!match.locked && resolved ? (
        <Predictor num={match.num} myPred={myPred} />
      ) : (
        <LockedPick match={match} myPred={myPred} />
      )}

      {host && resolved && !synced ? <HostEntry match={match} /> : null}
      {host && synced && match.status !== 'final' ? (
        <div class="sync-note">🔴 Results sync automatically from the live feed</div>
      ) : null}
    </article>
  );
}

function Stepper({ value, onDec, onInc }) {
  return (
    <div class="stepper">
      <button type="button" aria-label="decrease" onClick={onDec}>−</button>
      <span class="val num">{value}</span>
      <button type="button" aria-label="increase" onClick={onInc}>+</button>
    </div>
  );
}

function Predictor({ num, myPred }) {
  const [h, setH] = useState(myPred?.home ?? 0);
  const [a, setA] = useState(myPred?.away ?? 0);
  const [saved, setSaved] = useState(false);
  const [touched, setTouched] = useState(!!myPred);
  const timer = useRef(0);

  useEffect(() => {
    if (myPred) {
      setH(myPred.home);
      setA(myPred.away);
      setTouched(true);
    }
  }, [myPred?.home, myPred?.away]);

  function commit(nh, na) {
    setH(nh);
    setA(na);
    setTouched(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await predict(num, nh, na);
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
      } catch (e) {
        showToast(e.message);
      }
    }, 420);
  }

  const clamp = (n) => Math.max(0, Math.min(30, n));

  return (
    <div class="predict">
      <div class="predict-row">
        <Stepper value={h} onDec={() => commit(clamp(h - 1), a)} onInc={() => commit(clamp(h + 1), a)} />
        <span class="predict-mid">YOUR PICK</span>
        <Stepper value={a} onDec={() => commit(h, clamp(a - 1))} onInc={() => commit(h, clamp(a + 1))} />
      </div>
      <div class="predict-foot">
        <span class="lock-note">{touched ? 'Editable until kickoff' : 'Tap to make your prediction'}</span>
        <span class={`saved-tag ${saved ? 'show' : ''}`}>✓ Saved</span>
      </div>
    </div>
  );
}

function LockedPick({ match, myPred }) {
  const state = poolState.value;
  const myId = me.value;
  const [open, setOpen] = useState(false);
  const revealed = state.revealed?.[match.num] || [];
  const nameById = new Map((state.players || []).map((p) => [p.id, p.name]));
  const others = revealed
    .filter((r) => r.playerId !== myId)
    .sort((x, y) => y.points - x.points);

  return (
    <div class="your-pick-wrap">
      <div class="your-pick">
        {myPred ? (
          <span class="pk">Your pick: <b>{myPred.home}–{myPred.away}</b></span>
        ) : (
          <span class="pk faint">No prediction made</span>
        )}
        {match.status === 'final' && myPred ? (
          <span class={`pts-badge ${pointsClass(myPred.points)}`}>
            {myPred.points > 0 ? `+${myPred.points} pts` : '0 pts'}
          </span>
        ) : (
          <span class="lock-note">🔒 Locked</span>
        )}
      </div>
      {others.length ? (
        <>
          <button class="reveal-toggle" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : `See ${others.length} other pick${others.length === 1 ? '' : 's'}`}
          </button>
          {open ? (
            <div class="reveal-list">
              {others.map((r) => (
                <div class="reveal-item" key={r.playerId}>
                  <span>{nameById.get(r.playerId) || 'Player'}</span>
                  <span class="num">{r.home}–{r.away}{match.status === 'final' ? ` · ${r.points}pts` : ''}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function HostEntry({ match }) {
  const tmap = teamMap(poolState.value);
  const isKO = match.stage !== 'group';
  const [h, setH] = useState(match.homeScore ?? '');
  const [a, setA] = useState(match.awayScore ?? '');
  const [pen, setPen] = useState(match.penWinner ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setH(match.homeScore ?? '');
    setA(match.awayScore ?? '');
    setPen(match.penWinner ?? '');
  }, [match.homeScore, match.awayScore, match.penWinner]);

  const drawNeedsPen = isKO && h !== '' && a !== '' && Number(h) === Number(a);

  async function save() {
    if (h === '' || a === '') return showToast('Enter both scores');
    if (drawNeedsPen && !pen) return showToast('Pick the penalty-shootout winner');
    setBusy(true);
    try {
      await enterResult(match.num, Number(h), Number(a), drawNeedsPen ? pen : undefined);
      showToast(`Result saved: ${match.num}`);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    try {
      await clearResult(match.num);
      showToast('Result cleared');
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function lock() {
    try {
      await toggleLock(match.num, !match.locked);
    } catch (e) {
      showToast(e.message);
    }
  }

  return (
    <div class="host-entry">
      <div class="he-title">🛠 Host · enter result</div>
      <div class="he-row">
        <input class="he-score" type="number" min="0" max="30" inputMode="numeric"
          placeholder={tmap.get(match.home)?.code || 'H'} value={h}
          onInput={(e) => setH(e.target.value)} />
        <input class="he-score" type="number" min="0" max="30" inputMode="numeric"
          placeholder={tmap.get(match.away)?.code || 'A'} value={a}
          onInput={(e) => setA(e.target.value)} />
      </div>
      {drawNeedsPen ? (
        <div class="he-pen">
          <span class="faint">Pens:</span>
          <select class="input" style="padding:7px 9px" value={pen} onChange={(e) => setPen(e.target.value)}>
            <option value="">winner…</option>
            <option value={match.home}>{tmap.get(match.home)?.name}</option>
            <option value={match.away}>{tmap.get(match.away)?.name}</option>
          </select>
        </div>
      ) : null}
      <div class="he-actions">
        <button class="btn btn-gold btn-sm" disabled={busy} onClick={save}>
          {match.status === 'final' ? 'Update' : 'Save result'}
        </button>
        {match.status === 'final' ? (
          <button class="btn btn-ghost btn-sm" disabled={busy} onClick={clear}>Clear</button>
        ) : (
          <button class="btn btn-ghost btn-sm" onClick={lock}>{match.locked ? 'Unlock picks' : 'Lock picks'}</button>
        )}
      </div>
    </div>
  );
}
