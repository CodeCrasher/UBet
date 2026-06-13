// Live-sync layer. Pulls fixtures + results from a configured provider, turns
// them into a canonical tournament (stable per-pool match numbers), applies
// them to every synced pool, and pushes real-time updates. Provider-agnostic.

import * as thesportsdb from './providers/thesportsdb.mjs';
import * as footballdata from './providers/footballdata.mjs';
import { resolveTeam } from './data/countries.mjs';
import { setFixtures, getFixtures } from './fixtures.js';
import { applyCanonicalToPool, listSyncedPoolIds } from './pools.js';
import { pushPoolUpdate } from './realtime.js';

const PROVIDERS = { thesportsdb, footballdata };
const STAGE_ORDER = { group: 0, R32: 1, R16: 2, QF: 3, SF: 4, TP: 5, F: 6 };
const STAGE_LABEL = {
  group: 'Group', R32: 'Round of 32', R16: 'Round of 16',
  QF: 'Quarter-finals', SF: 'Semi-finals', TP: 'Third-place playoff', F: 'Final',
};

export function activeProvider() {
  return PROVIDERS[process.env.SYNC_PROVIDER] || null;
}
export function syncEnabled() {
  return !!activeProvider();
}

function roundLabel(stage, group) {
  if (stage === 'group') return group ? `Group ${group}` : 'Group stage';
  return STAGE_LABEL[stage] || stage;
}

/**
 * Turn normalized provider matches into a canonical fixture set. Match numbers
 * are kept stable across syncs by reusing the previous extId→num mapping, so a
 * player's prediction stays attached to the same fixture.
 */
function buildCanonical(raw, prev) {
  const prevByExt = new Map((prev?.matches || []).filter((m) => m.extId).map((m) => [m.extId, m.id]));
  let maxNum = Math.max(0, ...(prev?.matches || []).map((m) => m.id || 0));

  const teamMap = new Map();
  const resolved = raw.map((r) => {
    const home = r.homeName ? resolveTeam(r.homeName) : null;
    const away = r.awayName ? resolveTeam(r.awayName) : null;
    for (const [t, grp] of [[home, r.group], [away, r.group]]) {
      if (t && !teamMap.has(t.code)) teamMap.set(t.code, { code: t.code, name: t.name, flag: t.flag, group: r.stage === 'group' ? grp || null : null });
      else if (t && r.stage === 'group' && grp && !teamMap.get(t.code).group) teamMap.get(t.code).group = grp;
    }
    return { ...r, home, away };
  });

  resolved.sort(
    (a, b) =>
      (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9) ||
      (a.matchday || 0) - (b.matchday || 0) ||
      String(a.group || '').localeCompare(String(b.group || '')) ||
      String(a.kickoff).localeCompare(String(b.kickoff)) ||
      String(a.extId).localeCompare(String(b.extId)),
  );

  const matches = [];
  const results = {};
  for (const m of resolved) {
    let id = prevByExt.get(m.extId);
    if (id == null) id = ++maxNum;
    matches.push({
      id, extId: m.extId, stage: m.stage, round: roundLabel(m.stage, m.group),
      group: m.group || null, matchday: m.matchday || null,
      home: m.home?.code || null, away: m.away?.code || null,
      homeSource: null, awaySource: null, kickoff: m.kickoff,
    });
    results[id] = {
      status: m.status,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      penWinner: m.penWinnerName ? resolveTeam(m.penWinnerName)?.code : null,
    };
  }

  return {
    tournament: 'FIFA World Cup 2026',
    __synced: true,
    provider: process.env.SYNC_PROVIDER,
    syncedAt: new Date().toISOString(),
    teams: [...teamMap.values()],
    matches,
    results,
  };
}

let lastSignature = null;

export async function runSync(io, { force = false } = {}) {
  const provider = activeProvider();
  if (!provider) return { ok: false, reason: 'disabled' };
  const raw = await provider.fetchMatches();
  if (!raw.length) {
    console.warn(`⚠ sync: ${provider.label} returned 0 matches`);
    return { ok: false, reason: 'empty' };
  }
  const prev = getFixtures()?.__synced ? getFixtures() : null;
  const canonical = buildCanonical(raw, prev);

  const signature = JSON.stringify({ m: canonical.matches, r: canonical.results });
  if (!force && signature === lastSignature) return { ok: true, changed: false, matches: canonical.matches.length };
  lastSignature = signature;

  setFixtures(canonical); // new pools clone the real data

  let touched = 0;
  for (const poolId of listSyncedPoolIds()) {
    try {
      if (applyCanonicalToPool(poolId, canonical)) {
        if (io) pushPoolUpdate(io, poolId);
        touched++;
      }
    } catch (e) {
      console.warn(`sync: pool ${poolId} apply failed:`, e.message);
    }
  }
  console.log(`✓ sync (${provider.label}): ${canonical.matches.length} matches, ${touched} pool(s) updated`);
  return { ok: true, changed: true, matches: canonical.matches.length, poolsUpdated: touched };
}

export function startSync(io) {
  const provider = activeProvider();
  if (!provider) return;
  const interval = Math.max(15000, Number(process.env.SYNC_INTERVAL_MS) || 60000);
  console.log(`⚽ live sync ON — provider=${provider.label}, every ${Math.round(interval / 1000)}s`);
  runSync(io, { force: true }).catch((e) => console.warn('initial sync failed:', e.message));
  const timer = setInterval(() => runSync(io).catch((e) => console.warn('sync failed:', e.message)), interval);
  timer.unref?.();
  return timer;
}
