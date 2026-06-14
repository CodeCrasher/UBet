export function teamMap(state) {
  const m = new Map();
  if (state?.teams) for (const t of state.teams) m.set(t.code, t);
  return m;
}

export function fmtKickoff(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

const AVATAR_COLORS = ['#00b86b', '#2f7df6', '#e89b2c', '#9b5de5', '#ef5b5b', '#0fb5ba', '#f15bb5', '#5b8c00'];
export function colorFor(id = '') {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function money(n, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
}

export const ROUND_ORDER = [
  { key: 'md1', label: 'Matchday 1', test: (m) => m.stage === 'group' && m.matchday === 1 },
  { key: 'md2', label: 'Matchday 2', test: (m) => m.stage === 'group' && m.matchday === 2 },
  { key: 'md3', label: 'Matchday 3', test: (m) => m.stage === 'group' && m.matchday === 3 },
  { key: 'R32', label: 'Round of 32', test: (m) => m.stage === 'R32' },
  { key: 'R16', label: 'Round of 16', test: (m) => m.stage === 'R16' },
  { key: 'QF', label: 'Quarter-finals', test: (m) => m.stage === 'QF' },
  { key: 'SF', label: 'Semi-finals', test: (m) => m.stage === 'SF' },
  { key: 'TP', label: '3rd place', test: (m) => m.stage === 'TP' },
  { key: 'F', label: 'Final', test: (m) => m.stage === 'F' },
];

// The round to show by default: first round that still has an unplayed match,
// else the last round.
export function defaultRoundKey(matches = []) {
  for (const r of ROUND_ORDER) {
    const ms = matches.filter(r.test);
    if (ms.length && ms.some((m) => m.status !== 'final')) return r.key;
  }
  return ROUND_ORDER[ROUND_ORDER.length - 1].key;
}

export function pointsClass(p) {
  if (p >= 8) return 's5';
  if (p >= 3) return 's3';
  if (p >= 1) return 's1';
  return 's0';
}

const KO = ['R32', 'R16', 'QF', 'SF', 'TP', 'F'];
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// Per-market points breakdown for a pick vs a finished match. Mirrors
// server/scoring.js#scoreBreakdown — kept in sync for display only; the server
// remains authoritative for the stored `points`.
export function scoreBreakdown(pred, match, rules = {}) {
  const zero = { result: 0, exact: 0, goalDiff: 0, overUnder: 0, total: 0, multiplier: 1 };
  if (!pred || !match || match.status !== 'final') return zero;
  const ah = match.homeScore;
  const aa = match.awayScore;
  if (ah == null || aa == null || pred.home == null || pred.away == null) return zero;
  const ph = pred.home;
  const pa = pred.away;
  const exactHit = ph === ah && pa === aa;
  const line = rules.ouLine ?? 2.5;
  const result = sign(ph - pa) === sign(ah - aa) ? rules.result ?? 3 : 0;
  const exact = exactHit ? rules.exact ?? 5 : 0;
  const goalDiff = ph - pa === ah - aa && !exactHit ? rules.goalDiff ?? 2 : 0;
  const overUnder = ph + pa > line === ah + aa > line ? rules.overUnder ?? 2 : 0;
  const base = result + exact + goalDiff + overUnder;
  const multiplier = KO.includes(match.stage) ? rules.knockoutMultiplier || 1 : 1;
  return { result, exact, goalDiff, overUnder, total: base * multiplier, multiplier };
}

// Non-zero markets as labelled chips, for the points-calculation display.
export function breakdownChips(bd) {
  const out = [];
  if (bd.exact) out.push(['Exact', bd.exact]);
  if (bd.result) out.push(['Result', bd.result]);
  if (bd.goalDiff) out.push(['Goal diff', bd.goalDiff]);
  if (bd.overUnder) out.push(['O/U 2.5', bd.overUnder]);
  return out;
}
