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
  if (p >= 5) return 's5';
  if (p >= 3) return 's3';
  if (p >= 1) return 's1';
  return 's0';
}
