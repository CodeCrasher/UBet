// TheSportsDB adapter — free and keyless (shared test key "3").
// League 4429 = FIFA World Cup. Returns normalized matches; the sync layer
// turns these into canonical fixtures. Data completeness depends on what
// TheSportsDB has loaded for the season (often partial until kickoff nears).

export const id = 'thesportsdb';
export const label = 'TheSportsDB';
export const needsKey = false;

function mapStatus(e) {
  const s = String(e.strStatus || '').toUpperCase();
  if (['FT', 'AET', 'PEN', 'MATCH FINISHED', 'FINISHED'].some((k) => s.includes(k))) return 'final';
  if (['1H', '2H', 'HT', 'ET', 'LIVE', 'IN PLAY', 'PLAYING'].some((k) => s.includes(k))) return 'live';
  // fall back to score presence
  if (e.intHomeScore != null && e.intHomeScore !== '' && (s === '' || s === 'NS')) return 'final';
  return 'upcoming';
}

function mapStage(e) {
  const stage = String(e.strStage || '').toLowerCase();
  const round = String(e.strRound || e.intRound || '').toLowerCase();
  const hay = `${stage} ${round}`;
  if (hay.includes('final') && !hay.includes('semi') && !hay.includes('quarter')) {
    return hay.includes('third') || hay.includes('3rd') ? 'TP' : 'F';
  }
  if (hay.includes('third') || hay.includes('3rd')) return 'TP';
  if (hay.includes('semi')) return 'SF';
  if (hay.includes('quarter')) return 'QF';
  if (hay.includes('16')) return 'R16';
  if (hay.includes('32')) return 'R32';
  // group matchdays come through as plain round numbers 1–3
  const n = parseInt(e.intRound, 10);
  if (n >= 1 && n <= 3) return 'group';
  return 'group';
}

function num(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export async function fetchMatches(config = {}) {
  const key = config.apiKey || process.env.SPORTSDB_KEY || '3';
  const league = config.leagueId || process.env.SPORTSDB_LEAGUE || '4429';
  const season = config.season || process.env.SYNC_SEASON || '2026';
  const url = `https://www.thesportsdb.com/api/v1/json/${key}/eventsseason.php?id=${league}&s=${season}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`TheSportsDB HTTP ${res.status}`);
  const data = await res.json();
  const events = data.events || [];
  return events.map((e) => {
    const stage = mapStage(e);
    const kickoff = e.strTimestamp
      ? new Date(e.strTimestamp).toISOString()
      : new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}Z`).toISOString();
    const group = e.strGroup ? String(e.strGroup).replace(/group\s*/i, '').trim() || null : null;
    return {
      extId: String(e.idEvent),
      stage,
      group: stage === 'group' ? group : null,
      matchday: stage === 'group' ? num(e.intRound) || 1 : null,
      homeName: e.strHomeTeam,
      awayName: e.strAwayTeam,
      kickoff,
      homeScore: num(e.intHomeScore),
      awayScore: num(e.intAwayScore),
      status: mapStatus(e),
      penWinnerName: null,
    };
  });
}
