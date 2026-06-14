// Renders the right prediction control for the pool type and reports a
// normalised `pred` object via onChange.

function Winner({ options, fixture, value, onPick }) {
  const label = (w) => (w === 'HOME' ? fixture.homeTeam?.code || 'Home' : w === 'AWAY' ? fixture.awayTeam?.code || 'Away' : 'Draw');
  const sub = (w) => (w === 'HOME' ? 'Home win' : w === 'AWAY' ? 'Away win' : 'Level');
  return (
    <div class={`pred-winner ${options.length === 2 ? 'two' : ''}`}>
      {options.map((w) => (
        <button key={w} class={`pred-opt ${value === w ? 'on' : ''}`} onClick={() => onPick(w)}>
          {label(w)}<span class="sub">{sub(w)}</span>
        </button>
      ))}
    </div>
  );
}

function Stepper({ label, value, onChange, min = 0, max = 30 }) {
  const set = (v) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div>
      <div class="stepper-lbl">{label}</div>
      <div class="stepper">
        <button type="button" aria-label="decrease" onClick={() => set(value - 1)}>−</button>
        <span class="val num">{value}</span>
        <button type="button" aria-label="increase" onClick={() => set(value + 1)}>+</button>
      </div>
    </div>
  );
}

export function PredictionInput({ type, winnerOptions, fixture, pred, setPred }) {
  if (type === 'WINNER_BIG' || type === 'WINNER_SMALL') {
    return <Winner options={winnerOptions} fixture={fixture} value={pred.winner} onPick={(w) => setPred({ winner: w })} />;
  }
  if (type === 'EXACT') {
    return (
      <div class="stepper-grp">
        <Stepper label={fixture.homeTeam?.code || 'Home'} value={pred.home ?? 0} onChange={(v) => setPred({ ...pred, home: v })} />
        <span class="display" style="font-size:1.4rem">–</span>
        <Stepper label={fixture.awayTeam?.code || 'Away'} value={pred.away ?? 0} onChange={(v) => setPred({ ...pred, away: v })} />
      </div>
    );
  }
  if (type === 'TOTAL') {
    return (
      <div class="stepper-grp" style="grid-template-columns:1fr">
        <Stepper label="Total goals" value={pred.total ?? 0} onChange={(v) => setPred({ total: v })} max={60} />
      </div>
    );
  }
  if (type === 'MARGIN') {
    const isDraw = pred.winner === 'DRAW';
    return (
      <div>
        <Winner options={winnerOptions} fixture={fixture} value={pred.winner} onPick={(w) => setPred(w === 'DRAW' ? { winner: 'DRAW', margin: 0 } : { winner: w, margin: Math.max(1, pred.margin || 1) })} />
        {pred.winner && !isDraw ? (
          <div class="stepper-grp" style="grid-template-columns:1fr;margin-top:4px">
            <Stepper label="Winning margin" value={pred.margin ?? 1} onChange={(v) => setPred({ ...pred, margin: Math.max(1, v) })} min={1} />
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}

export function predReady(type, pred) {
  switch (type) {
    case 'WINNER_BIG':
    case 'WINNER_SMALL':
      return !!pred.winner;
    case 'EXACT':
      return Number.isInteger(pred.home) && Number.isInteger(pred.away);
    case 'TOTAL':
      return Number.isInteger(pred.total);
    case 'MARGIN':
      return pred.winner === 'DRAW' ? true : !!pred.winner && pred.margin >= 1;
    default:
      return false;
  }
}
