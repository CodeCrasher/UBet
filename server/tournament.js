import db from './db.js';
import { getFixtures, invalidateFixturesCache } from './fixtures.js';
import { now } from './util.js';
import { HOME, AWAY, DRAW } from './settle.js';

const KO_ORDER = ['R32', 'R16', 'QF', 'SF', 'TP', 'F'];
const isKnockoutStage = (s) => KO_ORDER.includes(s);

const stmt = {
  count: db.prepare('SELECT COUNT(*) AS n FROM fixtures'),
  insert: db.prepare(`INSERT INTO fixtures
    (num, stage, round, group_name, matchday, home, away, home_source, away_source, knockout, kickoff, venue, status, settled, updated_at)
    VALUES (@num, @stage, @round, @group_name, @matchday, @home, @away, @home_source, @away_source, @knockout, @kickoff, @venue, 'upcoming', 0, @updated_at)`),
  // Resync: add any genuinely-new fixtures (schema growth), never clobber existing rows.
  resyncInsert: db.prepare(`INSERT OR IGNORE INTO fixtures
    (num, stage, round, group_name, matchday, home, away, home_source, away_source, knockout, kickoff, venue, status, settled, updated_at)
    VALUES (@num, @stage, @round, @group_name, @matchday, @home, @away, @home_source, @away_source, @knockout, @kickoff, @venue, 'upcoming', 0, @updated_at)`),
  // Resync: refresh schedule fields only — never touch results/scores/status/settled.
  resyncUpdate: db.prepare(`UPDATE fixtures SET kickoff=@kickoff, venue=@venue, updated_at=@updated_at
    WHERE num=@num AND status='upcoming' AND settled=0`),
  all: db.prepare('SELECT * FROM fixtures ORDER BY num'),
  byNum: db.prepare('SELECT * FROM fixtures WHERE num = ?'),
  liveByNum: db.prepare('SELECT * FROM live_state WHERE fixture_num = ?'),
  insertLive: db.prepare(`INSERT OR IGNORE INTO live_state (fixture_num, updated_at) VALUES (?, ?)`),
  setTeams: db.prepare('UPDATE fixtures SET home=@home, away=@away, updated_at=@updated_at WHERE num=@num'),
  setResult: db.prepare(`UPDATE fixtures SET home_score=@home_score, away_score=@away_score, pen_winner=@pen_winner,
    status=@status, settled=@settled, updated_at=@updated_at WHERE num=@num`),
  setStatus: db.prepare('UPDATE fixtures SET status=@status, updated_at=@updated_at WHERE num=@num'),
};

export function loadFixtures() {
  if (stmt.count.get().n > 0) return;
  const fx = getFixtures();
  const tx = db.transaction(() => {
    for (const m of fx.matches) {
      stmt.insert.run({
        num: m.id, stage: m.stage, round: m.round, group_name: m.group ?? null, matchday: m.matchday ?? null,
        home: m.home ?? null, away: m.away ?? null, home_source: m.homeSource ?? null, away_source: m.awaySource ?? null,
        knockout: isKnockoutStage(m.stage) ? 1 : 0, kickoff: m.kickoff, venue: m.venue ?? null, updated_at: now(),
      });
      stmt.insertLive.run(m.id, now());
    }
  });
  tx();
}

/**
 * Force-refresh the DB schedule from the committed fixtures.json without
 * wiping user data. `loadFixtures()` is a one-time seed (it bails when rows
 * exist), so on an already-seeded volume this is the only way to push a newly
 * built schedule (real kickoffs + venues) into the DB.
 *
 * SAFE: only `kickoff` + `venue` are updated, and only for fixtures still
 * `upcoming` and unsettled. Scores, status, settlement, pools, entries and
 * balances are never touched. Brand-new fixtures (none today) are inserted.
 */
export function resyncFixtures() {
  invalidateFixturesCache(); // drop the in-memory snapshot → re-read fixtures.json from disk
  const fx = getFixtures();
  const tx = db.transaction(() => {
    for (const m of fx.matches) {
      stmt.resyncInsert.run({
        num: m.id, stage: m.stage, round: m.round, group_name: m.group ?? null, matchday: m.matchday ?? null,
        home: m.home ?? null, away: m.away ?? null, home_source: m.homeSource ?? null, away_source: m.awaySource ?? null,
        knockout: isKnockoutStage(m.stage) ? 1 : 0, kickoff: m.kickoff, venue: m.venue ?? null, updated_at: now(),
      });
      stmt.insertLive.run(m.id, now());
      stmt.resyncUpdate.run({ num: m.id, kickoff: m.kickoff, venue: m.venue ?? null, updated_at: now() });
    }
  });
  tx();
  console.log(`✓ resyncFixtures: refreshed kickoff + venue for ${fx.matches.length} fixtures (results untouched)`);
  return fx.matches.length;
}

export const getFixture = (num) => stmt.byNum.get(num);
export const getLive = (num) => stmt.liveByNum.get(num) || { fixture_num: num, home_goals: 0, away_goals: 0, minute: 0, phase: 'NOT_STARTED' };
export const allFixtures = () => stmt.all.all();
export const setFixtureStatus = (num, status) => stmt.setStatus.run({ num, status, updated_at: now() });
export const setFixtureResult = (row) => stmt.setResult.run({ ...row, updated_at: now() });
export const setFixtureTeams = (num, home, away) => stmt.setTeams.run({ num, home, away, updated_at: now() });

// Lock once the match starts (kickoff passed, or live/final).
export function isLocked(fixture) {
  if (!fixture) return true;
  if (fixture.status === 'live' || fixture.status === 'final') return true;
  return Date.now() >= new Date(fixture.kickoff).getTime();
}

// ── knockout bracket resolution (mirrors the seed bracket) ──
function winnerCode(f) {
  if (f.status !== 'final' || f.home == null || f.away == null) return null;
  if (f.home_score > f.away_score) return f.home;
  if (f.away_score > f.home_score) return f.away;
  return f.pen_winner || null;
}
function loserCode(f) {
  const w = winnerCode(f);
  if (!w) return null;
  return w === f.home ? f.away : f.home;
}

function groupStandings(fixtures) {
  const teams = getFixtures().teams;
  const tables = new Map();
  for (const t of teams) {
    if (!t.group) continue;
    if (!tables.has(t.group)) tables.set(t.group, new Map());
    tables.get(t.group).set(t.code, { team: t.code, gf: 0, ga: 0, pts: 0, played: 0 });
  }
  const totals = new Map();
  const finals = new Map();
  for (const f of fixtures) {
    if (f.stage !== 'group') continue;
    totals.set(f.group_name, (totals.get(f.group_name) || 0) + 1);
    if (f.status !== 'final' || f.home_score == null) continue;
    finals.set(f.group_name, (finals.get(f.group_name) || 0) + 1);
    const t = tables.get(f.group_name);
    const h = t.get(f.home);
    const a = t.get(f.away);
    h.played++; a.played++;
    h.gf += f.home_score; h.ga += f.away_score; a.gf += f.away_score; a.ga += f.home_score;
    if (f.home_score > f.away_score) h.pts += 3;
    else if (f.away_score > f.home_score) a.pts += 3;
    else { h.pts++; a.pts++; }
  }
  const out = new Map();
  for (const [g, t] of tables) {
    const rows = [...t.values()].map((r) => ({ ...r, gd: r.gf - r.ga }));
    rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
    rows.complete = (finals.get(g) || 0) === (totals.get(g) || 0) && (totals.get(g) || 0) > 0;
    out.set(g, rows);
  }
  return out;
}

/** Fill knockout fixture teams from group standings + finished KO matches. Idempotent. */
export function resolveKnockouts() {
  const fixtures = allFixtures();
  const standings = groupStandings(fixtures);
  const slot = new Map();
  let allGroupsDone = true;
  for (const [g, rows] of standings) {
    if (rows.complete) {
      slot.set(`1${g}`, rows[0].team);
      slot.set(`2${g}`, rows[1].team);
    } else allGroupsDone = false;
  }
  if (allGroupsDone) {
    const thirds = [...standings].map(([g, rows]) => ({ ...rows[2], group: g }))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.group.localeCompare(b.group))
      .slice(0, 8)
      .sort((a, b) => a.group.localeCompare(b.group));
    thirds.forEach((t, i) => slot.set(`3-${i + 1}`, t.team));
  }
  const byNum = new Map(fixtures.map((f) => [f.num, f]));
  const resolveSrc = (src) => {
    if (!src) return null;
    if (src.startsWith('WM:')) return winnerCode(byNum.get(Number(src.slice(3))));
    if (src.startsWith('LM:')) return loserCode(byNum.get(Number(src.slice(3))));
    return slot.get(src) ?? null;
  };
  const tx = db.transaction(() => {
    for (const stage of KO_ORDER) {
      for (const f of fixtures) {
        if (f.stage !== stage) continue;
        const home = resolveSrc(f.home_source);
        const away = resolveSrc(f.away_source);
        if (home !== f.home || away !== f.away) {
          stmt.setTeams.run({ num: f.num, home, away, updated_at: now() });
          f.home = home; f.away = away;
        }
      }
    }
  });
  tx();
}

export function sourceLabel(src) {
  if (!src) return 'TBD';
  if (src.startsWith('WM:')) return `Winner M${src.slice(3)}`;
  if (src.startsWith('LM:')) return `Loser M${src.slice(3)}`;
  if (src.startsWith('3-')) return `3rd #${src.slice(2)}`;
  return `${src[0] === '1' ? 'Winner' : 'Runner-up'} Grp ${src.slice(1)}`;
}

// Allowed winner picks for a fixture (no DRAW in knockouts).
export function winnerOptions(fixture) {
  return fixture.knockout ? [HOME, AWAY] : [HOME, DRAW, AWAY];
}
