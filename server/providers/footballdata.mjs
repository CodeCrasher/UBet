// football-data.org adapter — recommended for accurate, complete World Cup
// data and live results. Requires a free API key (https://football-data.org).
// Set FOOTBALL_DATA_API_KEY and SYNC_PROVIDER=footballdata.

export const id = 'footballdata';
export const label = 'football-data.org';
export const needsKey = true;

const STAGE_MAP = {
  GROUP_STAGE: 'group',
  LAST_32: 'R32',
  ROUND_OF_32: 'R32',
  LAST_16: 'R16',
  ROUND_OF_16: 'R16',
  QUARTER_FINALS: 'QF',
  SEMI_FINALS: 'SF',
  THIRD_PLACE: 'TP',
  FINAL: 'F',
};

function mapStatus(s) {
  if (s === 'FINISHED' || s === 'AWARDED') return 'final';
  if (s === 'IN_PLAY' || s === 'PAUSED' || s === 'LIVE') return 'live';
  return 'upcoming';
}

export async function fetchMatches(config = {}) {
  const key = config.apiKey || process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error('FOOTBALL_DATA_API_KEY is required for the football-data provider');
  const comp = config.competition || process.env.FOOTBALL_DATA_COMPETITION || 'WC';
  const season = config.season || process.env.SYNC_SEASON;
  const qs = season ? `?season=${season}` : '';
  const url = `https://api.football-data.org/v4/competitions/${comp}/matches${qs}`;
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': key },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`football-data HTTP ${res.status}`);
  const data = await res.json();
  const matches = data.matches || [];
  return matches.map((m) => {
    const stage = STAGE_MAP[m.stage] || 'group';
    const ft = m.score?.fullTime || {};
    let penWinnerName = null;
    if (m.score?.duration === 'PENALTY_SHOOTOUT' || m.score?.penalties) {
      if (m.score?.winner === 'HOME_TEAM') penWinnerName = m.homeTeam?.name;
      else if (m.score?.winner === 'AWAY_TEAM') penWinnerName = m.awayTeam?.name;
    }
    return {
      extId: String(m.id),
      stage,
      group: m.group ? String(m.group).replace(/GROUP_?/i, '').trim() : null,
      matchday: stage === 'group' ? m.matchday ?? null : null,
      homeName: m.homeTeam?.name || m.homeTeam?.tla || null,
      awayName: m.awayTeam?.name || m.awayTeam?.tla || null,
      kickoff: m.utcDate,
      homeScore: ft.home ?? null,
      awayScore: ft.away ?? null,
      status: mapStatus(m.status),
      penWinnerName,
    };
  });
}
