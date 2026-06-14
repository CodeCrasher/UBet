export function money(n) {
  const v = Math.round(n || 0);
  return `Rs ${v.toLocaleString('en-IN')}`;
}
export function signed(n) {
  const v = Math.round(n || 0);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}Rs ${Math.abs(v).toLocaleString('en-IN')}`;
}

export function fmtKickoff(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export const WINNER_LABEL = { HOME: 'Home', DRAW: 'Draw', AWAY: 'Away' };
export const PHASE_LABEL = {
  NOT_STARTED: 'Not started', FIRST_HALF: '1st half', HALFTIME: 'Half time',
  SECOND_HALF: '2nd half', ET: 'Extra time', PENS: 'Penalties', FULL_TIME: 'Full time',
};

// Human prediction text for any pool type.
export function predText(type, pred, fixture) {
  if (!pred) return '—';
  const side = (w) => (w === 'HOME' ? abbr(fixture?.homeTeam) || 'Home' : w === 'AWAY' ? abbr(fixture?.awayTeam) || 'Away' : 'Draw');
  switch (type) {
    case 'WINNER_BIG':
    case 'WINNER_SMALL':
      return side(pred.winner);
    case 'EXACT':
      return `${pred.home}–${pred.away}`;
    case 'TOTAL':
      return `${pred.total} goals`;
    case 'MARGIN':
      return pred.winner === 'DRAW' ? 'Draw' : `${side(pred.winner)} by ${pred.margin}`;
    default:
      return '—';
  }
}

export function abbr(team) {
  return team ? team.code : null;
}
export function flag(team) {
  return team ? team.flag : '🏳️';
}

// Split a number into flap chars (digits + grouping separators).
export function flapChars(n) {
  return String(Math.round(n || 0)).split('');
}
