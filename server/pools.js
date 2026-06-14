import { customAlphabet, nanoid } from 'nanoid';
import db from './db.js';
import { getFixtures } from './fixtures.js';
import { hashPin, newToken } from './auth.js';
import {
  DEFAULT_RULES,
  scorePrediction,
  buildLeaderboard,
  computeGroupStandings,
  selectBestThirds,
} from './scoring.js';

// Room codes: unambiguous uppercase (no O/0/I/1).
const roomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// ── prepared statements ──
const stmt = {
  insertPool: db.prepare(`INSERT INTO pools (id, code, name, buy_in, currency, rules, pin_hash, pin_salt, status, synced, created_at)
    VALUES (@id, @code, @name, @buy_in, @currency, @rules, @pin_hash, @pin_salt, 'live', @synced, @created_at)`),
  poolByCode: db.prepare('SELECT * FROM pools WHERE code = ?'),
  poolById: db.prepare('SELECT * FROM pools WHERE id = ?'),
  syncedPoolIds: db.prepare('SELECT id FROM pools WHERE synced = 1'),
  insertMatch: db.prepare(`INSERT INTO matches
    (id, pool_id, num, stage, round, group_name, matchday, home, away, home_source, away_source, ext_id, kickoff, status, locked, updated_at)
    VALUES (@id, @pool_id, @num, @stage, @round, @group_name, @matchday, @home, @away, @home_source, @away_source, @ext_id, @kickoff, 'upcoming', 0, @updated_at)`),
  updateMatchStructure: db.prepare(`UPDATE matches SET stage=@stage, round=@round, group_name=@group_name,
    matchday=@matchday, home=@home, away=@away, ext_id=@ext_id, kickoff=@kickoff, updated_at=@updated_at WHERE id=@id`),
  matchesByPool: db.prepare('SELECT * FROM matches WHERE pool_id = ? ORDER BY num'),
  matchByNum: db.prepare('SELECT * FROM matches WHERE pool_id = ? AND num = ?'),
  updateMatchTeams: db.prepare('UPDATE matches SET home = @home, away = @away, updated_at = @updated_at WHERE id = @id'),
  updateMatchResult: db.prepare(`UPDATE matches SET home_score = @home_score, away_score = @away_score,
    pen_winner = @pen_winner, status = @status, locked = @locked, updated_at = @updated_at WHERE id = @id`),
  updateMatchLock: db.prepare('UPDATE matches SET locked = @locked, updated_at = @updated_at WHERE id = @id'),
  insertPlayer: db.prepare(`INSERT INTO players (id, pool_id, display_name, token, is_host, paid, seq, joined_at)
    VALUES (@id, @pool_id, @display_name, @token, @is_host, @paid, @seq, @joined_at)`),
  playersByPool: db.prepare('SELECT * FROM players WHERE pool_id = ? ORDER BY seq'),
  playerByToken: db.prepare('SELECT * FROM players WHERE token = ?'),
  playerById: db.prepare('SELECT * FROM players WHERE id = ?'),
  countPlayers: db.prepare('SELECT COUNT(*) AS n FROM players WHERE pool_id = ?'),
  setPaid: db.prepare('UPDATE players SET paid = @paid WHERE id = @id'),
  predsByPool: db.prepare('SELECT * FROM predictions WHERE pool_id = ?'),
  predsByPlayer: db.prepare('SELECT * FROM predictions WHERE player_id = ?'),
  predsByMatch: db.prepare('SELECT * FROM predictions WHERE match_id = ?'),
  predByPlayerMatch: db.prepare('SELECT * FROM predictions WHERE player_id = ? AND match_id = ?'),
  upsertPred: db.prepare(`INSERT INTO predictions (id, pool_id, player_id, match_id, home_pred, away_pred, points, updated_at)
    VALUES (@id, @pool_id, @player_id, @match_id, @home_pred, @away_pred, 0, @updated_at)
    ON CONFLICT(player_id, match_id) DO UPDATE SET home_pred = @home_pred, away_pred = @away_pred, updated_at = @updated_at`),
  updatePredPoints: db.prepare('UPDATE predictions SET points = @points WHERE id = @id'),
  setPoolStatus: db.prepare('UPDATE pools SET status = @status WHERE id = @id'),
  updatePoolSettings: db.prepare('UPDATE pools SET name = @name, buy_in = @buy_in, currency = @currency, rules = @rules WHERE id = @id'),
  // custom bets
  insertCustomBet: db.prepare(`INSERT INTO custom_bets (id, pool_id, question, options, points, answer, created_at)
    VALUES (@id, @pool_id, @question, @options, @points, NULL, @created_at)`),
  customBetsByPool: db.prepare('SELECT * FROM custom_bets WHERE pool_id = ? ORDER BY created_at'),
  customBetById: db.prepare('SELECT * FROM custom_bets WHERE id = ?'),
  updateCustomBet: db.prepare('UPDATE custom_bets SET question=@question, options=@options, points=@points, answer=@answer WHERE id=@id'),
  deleteCustomBet: db.prepare('DELETE FROM custom_bets WHERE id = ?'),
  answersByPool: db.prepare('SELECT * FROM custom_answers WHERE pool_id = ?'),
  upsertCustomAnswer: db.prepare(`INSERT INTO custom_answers (id, pool_id, bet_id, player_id, answer, updated_at)
    VALUES (@id, @pool_id, @bet_id, @player_id, @answer, @updated_at)
    ON CONFLICT(bet_id, player_id) DO UPDATE SET answer=@answer, updated_at=@updated_at`),
};

const now = () => new Date().toISOString();

function parseRules(pool) {
  const stored = JSON.parse(pool.rules);
  // Migrate the legacy single-tier scheme ({exact, resultGd, result}) to the
  // additive market scheme, preserving any custom knockout multiplier.
  if ('resultGd' in stored) {
    return { ...DEFAULT_RULES, knockoutMultiplier: Number(stored.knockoutMultiplier) || DEFAULT_RULES.knockoutMultiplier };
  }
  return { ...DEFAULT_RULES, ...sanitizeRules(stored) };
}

function sanitizeRules(input = {}) {
  const r = { ...DEFAULT_RULES };
  for (const k of ['result', 'exact', 'goalDiff', 'overUnder', 'ouLine', 'knockoutMultiplier']) {
    if (input[k] != null && Number.isFinite(Number(input[k]))) {
      r[k] = Math.max(0, Number(input[k]));
    }
  }
  return r;
}

// ── pool creation ──
export function createPool({ name, buyIn, currency, rules, pin, hostName, synced = false }) {
  const fixtures = getFixtures();
  let code;
  // very unlikely collision, but be safe
  for (let i = 0; i < 5; i++) {
    code = roomCode();
    if (!stmt.poolByCode.get(code)) break;
  }
  const id = nanoid(12);
  const ts = now();
  const { hash, salt } = hashPin(pin);
  const poolRow = {
    id,
    code,
    name: name?.trim() || 'World Cup Pool',
    buy_in: Number(buyIn) || 0,
    currency: (currency || 'USD').toUpperCase().slice(0, 4),
    rules: JSON.stringify(sanitizeRules(rules)),
    pin_hash: hash,
    pin_salt: salt,
    synced: synced ? 1 : 0,
    created_at: ts,
  };

  const tx = db.transaction(() => {
    stmt.insertPool.run(poolRow);
    for (const m of fixtures.matches) {
      stmt.insertMatch.run({
        id: `${id}:${m.id}`,
        pool_id: id,
        num: m.id,
        stage: m.stage,
        round: m.round,
        group_name: m.group ?? null,
        matchday: m.matchday ?? null,
        home: m.home ?? null,
        away: m.away ?? null,
        home_source: m.homeSource ?? null,
        away_source: m.awaySource ?? null,
        ext_id: m.extId ?? null,
        kickoff: m.kickoff,
        updated_at: ts,
      });
    }
  });
  tx();

  // If the pool is synced, immediately apply any results the provider already has.
  if (synced) applyCanonicalToPool(id, fixtures);

  const host = addPlayer({ poolId: id, displayName: hostName || 'Host', isHost: true });
  return { pool: stmt.poolById.get(id), host };
}

export function listSyncedPoolIds() {
  return stmt.syncedPoolIds.all().map((r) => r.id);
}

/**
 * Apply a synced canonical fixture set (structure + results) to one pool.
 * Used for provider-driven pools: teams/kickoffs come from the feed and
 * results are applied + scored automatically. Returns true if anything changed.
 */
export function applyCanonicalToPool(poolId, canonical) {
  const pool = getPoolById(poolId);
  if (!pool || !canonical?.matches) return false;
  const rules = parseRules(pool);
  const results = canonical.results || {};
  let changed = false;

  const tx = db.transaction(() => {
    for (const m of canonical.matches) {
      let row = stmt.matchByNum.get(poolId, m.id);
      if (!row) {
        stmt.insertMatch.run({
          id: `${poolId}:${m.id}`, pool_id: poolId, num: m.id, stage: m.stage, round: m.round,
          group_name: m.group ?? null, matchday: m.matchday ?? null, home: m.home ?? null, away: m.away ?? null,
          home_source: m.homeSource ?? null, away_source: m.awaySource ?? null, ext_id: m.extId ?? null,
          kickoff: m.kickoff, updated_at: now(),
        });
        changed = true;
      } else if (
        row.home !== (m.home ?? null) || row.away !== (m.away ?? null) ||
        row.kickoff !== m.kickoff || row.stage !== m.stage ||
        row.group_name !== (m.group ?? null) || row.ext_id !== (m.extId ?? null)
      ) {
        stmt.updateMatchStructure.run({
          id: row.id, stage: m.stage, round: m.round, group_name: m.group ?? null, matchday: m.matchday ?? null,
          home: m.home ?? null, away: m.away ?? null, ext_id: m.extId ?? null, kickoff: m.kickoff, updated_at: now(),
        });
        changed = true;
      }

      row = stmt.matchByNum.get(poolId, m.id);
      const r = results[m.id];
      if (r && r.status === 'final' && r.homeScore != null && r.awayScore != null) {
        if (row.status !== 'final' || row.home_score !== r.homeScore || row.away_score !== r.awayScore || row.pen_winner !== (r.penWinner ?? null)) {
          stmt.updateMatchResult.run({
            id: row.id, home_score: r.homeScore, away_score: r.awayScore, pen_winner: r.penWinner ?? null,
            status: 'final', locked: 1, updated_at: now(),
          });
          recomputeMatchPoints(row.id, { ...row, home_score: r.homeScore, away_score: r.awayScore, status: 'final' }, rules);
          changed = true;
        }
      } else if (r && r.status === 'live') {
        if (row.status !== 'live' || row.home_score !== (r.homeScore ?? null) || row.away_score !== (r.awayScore ?? null)) {
          stmt.updateMatchResult.run({
            id: row.id, home_score: r.homeScore ?? null, away_score: r.awayScore ?? null, pen_winner: null,
            status: 'live', locked: 1, updated_at: now(),
          });
          changed = true;
        }
      } else if (row.status === 'final') {
        // provider walked a result back — clear it
        stmt.updateMatchResult.run({
          id: row.id, home_score: null, away_score: null, pen_winner: null, status: 'upcoming', locked: 0, updated_at: now(),
        });
        for (const p of stmt.predsByMatch.all(row.id)) stmt.updatePredPoints.run({ id: p.id, points: 0 });
        changed = true;
      }
    }
    maybeFinishPool(poolId);
  });
  tx();
  return changed;
}

export function getPoolByCode(code) {
  return code ? stmt.poolByCode.get(String(code).toUpperCase().trim()) : null;
}
export function getPoolById(id) {
  return stmt.poolById.get(id);
}
export function getPlayerByToken(token) {
  return token ? stmt.playerByToken.get(token) : null;
}

// ── join / players ──
export function addPlayer({ poolId, displayName, isHost = false }) {
  const name = String(displayName || '').trim().slice(0, 32);
  if (!name) throw httpError(400, 'Display name required');
  const existing = stmt.playersByPool.all(poolId).find((p) => p.display_name.toLowerCase() === name.toLowerCase());
  if (existing) throw httpError(409, 'That name is already taken in this pool');
  const seq = stmt.countPlayers.get(poolId).n + 1;
  const player = {
    id: nanoid(12),
    pool_id: poolId,
    display_name: name,
    token: newToken(),
    is_host: isHost ? 1 : 0,
    paid: 0,
    seq,
    joined_at: now(),
  };
  stmt.insertPlayer.run(player);
  return player;
}

export function joinPool({ code, displayName }) {
  const pool = getPoolByCode(code);
  if (!pool) throw httpError(404, 'Pool not found — check the code');
  return { pool, player: addPlayer({ poolId: pool.id, displayName }) };
}

export function setPlayerPaid(poolId, playerId, paid) {
  const player = stmt.playerById.get(playerId);
  if (!player || player.pool_id !== poolId) throw httpError(404, 'Player not found');
  stmt.setPaid.run({ id: playerId, paid: paid ? 1 : 0 });
  return stmt.playerById.get(playerId);
}

// ── predictions ──
function lockState(match) {
  // effective status + lock, computed against wall clock
  if (match.status === 'final') return { status: 'final', locked: true };
  const kicked = Date.now() >= new Date(match.kickoff).getTime();
  if (match.locked || kicked) return { status: 'live', locked: true };
  return { status: 'upcoming', locked: false };
}

export function submitPrediction({ poolId, playerId, num, home, away, force = false }) {
  const match = stmt.matchByNum.get(poolId, num);
  if (!match) throw httpError(404, 'Match not found');
  if (!force && lockState(match).locked) throw httpError(409, 'Predictions are locked for this match');
  const h = clampScore(home);
  const a = clampScore(away);
  if (h == null || a == null) throw httpError(400, 'Scores must be whole numbers 0–30');
  stmt.upsertPred.run({
    id: nanoid(12),
    pool_id: poolId,
    player_id: playerId,
    match_id: match.id,
    home_pred: h,
    away_pred: a,
    updated_at: now(),
  });
  return stmt.predByPlayerMatch.get(playerId, match.id);
}

function clampScore(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 30) return null;
  return n;
}

// ── results + recompute + bracket resolution ──
export function enterResult({ poolId, num, homeScore, awayScore, penWinner }) {
  const pool = getPoolById(poolId);
  const match = stmt.matchByNum.get(poolId, num);
  if (!match) throw httpError(404, 'Match not found');
  if (match.home == null || match.away == null) throw httpError(409, 'This fixture has no teams resolved yet');
  const h = clampScore(homeScore);
  const a = clampScore(awayScore);
  if (h == null || a == null) throw httpError(400, 'Scores must be whole numbers 0–30');

  let pen = null;
  if (h === a && match.stage !== 'group') {
    // knockout draw must be decided
    if (penWinner && (penWinner === match.home || penWinner === match.away)) pen = penWinner;
    else throw httpError(400, 'A drawn knockout match needs a penalty-shootout winner');
  }

  const rules = parseRules(pool);
  const tx = db.transaction(() => {
    stmt.updateMatchResult.run({
      id: match.id,
      home_score: h,
      away_score: a,
      pen_winner: pen,
      status: 'final',
      locked: 1,
      updated_at: now(),
    });
    recomputeMatchPoints(match.id, { ...match, home_score: h, away_score: a, status: 'final' }, rules);
    resolveKnockouts(poolId);
    maybeFinishPool(poolId);
  });
  tx();
  return stmt.matchesByPool.all(poolId);
}

export function clearResult({ poolId, num }) {
  const match = stmt.matchByNum.get(poolId, num);
  if (!match) throw httpError(404, 'Match not found');
  const tx = db.transaction(() => {
    stmt.updateMatchResult.run({
      id: match.id, home_score: null, away_score: null, pen_winner: null,
      status: 'upcoming', locked: 0, updated_at: now(),
    });
    for (const p of stmt.predsByMatch.all(match.id)) stmt.updatePredPoints.run({ id: p.id, points: 0 });
    resolveKnockouts(poolId);
    stmt.setPoolStatus.run({ id: poolId, status: 'live' });
  });
  tx();
  return stmt.matchesByPool.all(poolId);
}

export function setMatchLock({ poolId, num, locked }) {
  const match = stmt.matchByNum.get(poolId, num);
  if (!match) throw httpError(404, 'Match not found');
  stmt.updateMatchLock.run({ id: match.id, locked: locked ? 1 : 0, updated_at: now() });
  return stmt.matchByNum.get(poolId, num);
}

function recomputeMatchPoints(matchId, matchObj, rules) {
  for (const pred of stmt.predsByMatch.all(matchId)) {
    const points = scorePrediction(pred, matchObj, rules);
    stmt.updatePredPoints.run({ id: pred.id, points });
  }
}

export function recomputeAllPoints(poolId) {
  const pool = getPoolById(poolId);
  const rules = parseRules(pool);
  const matches = stmt.matchesByPool.all(poolId);
  const tx = db.transaction(() => {
    for (const m of matches) {
      if (m.status === 'final') recomputeMatchPoints(m.id, m, rules);
    }
  });
  tx();
}

export function updateSettings({ poolId, name, buyIn, currency, rules }) {
  const pool = getPoolById(poolId);
  if (!pool) throw httpError(404, 'Pool not found');
  const next = {
    id: poolId,
    name: name?.trim() || pool.name,
    buy_in: buyIn != null ? Number(buyIn) || 0 : pool.buy_in,
    currency: currency ? currency.toUpperCase().slice(0, 4) : pool.currency,
    rules: JSON.stringify(rules ? sanitizeRules(rules) : parseRules(pool)),
  };
  stmt.updatePoolSettings.run(next);
  if (rules) recomputeAllPoints(poolId);
  return getPoolById(poolId);
}

// ── custom bets (pool-level prop bets) ──
function parseOptions(options) {
  let arr = null;
  if (Array.isArray(options)) arr = options;
  else if (typeof options === 'string' && options.trim()) arr = options.split(',');
  if (!arr) return null;
  const clean = arr.map((o) => String(o).trim()).filter(Boolean);
  return clean.length >= 2 ? clean : null; // <2 options ⇒ free-text answer
}

export function createCustomBet({ poolId, question, options, points }) {
  const q = String(question || '').trim();
  if (!q) throw httpError(400, 'Bet question is required');
  const opts = parseOptions(options);
  const id = nanoid(12);
  stmt.insertCustomBet.run({
    id, pool_id: poolId, question: q.slice(0, 140),
    options: opts ? JSON.stringify(opts) : null,
    points: Math.max(0, Math.min(50, Number(points) || 0)),
    created_at: now(),
  });
  return stmt.customBetById.get(id);
}

export function updateCustomBet({ poolId, betId, question, options, points, answer }) {
  const bet = stmt.customBetById.get(betId);
  if (!bet || bet.pool_id !== poolId) throw httpError(404, 'Bet not found');
  let opts = bet.options;
  if (options !== undefined) {
    const parsed = parseOptions(options);
    opts = parsed ? JSON.stringify(parsed) : null;
  }
  let ans = bet.answer;
  if (answer !== undefined) ans = answer == null || String(answer).trim() === '' ? null : String(answer).trim();
  stmt.updateCustomBet.run({
    id: betId,
    question: question !== undefined ? String(question).trim().slice(0, 140) || bet.question : bet.question,
    options: opts,
    points: points !== undefined ? Math.max(0, Math.min(50, Number(points) || 0)) : bet.points,
    answer: ans,
  });
  return stmt.customBetById.get(betId);
}

export function deleteCustomBet({ poolId, betId }) {
  const bet = stmt.customBetById.get(betId);
  if (!bet || bet.pool_id !== poolId) throw httpError(404, 'Bet not found');
  stmt.deleteCustomBet.run(betId);
}

export function answerCustomBet({ poolId, betId, playerId, answer }) {
  const bet = stmt.customBetById.get(betId);
  if (!bet || bet.pool_id !== poolId) throw httpError(404, 'Bet not found');
  if (bet.answer != null) throw httpError(409, 'This bet is already settled');
  const a = String(answer || '').trim();
  if (!a) throw httpError(400, 'Pick an answer');
  if (bet.options) {
    const opts = JSON.parse(bet.options);
    if (!opts.some((o) => o.toLowerCase() === a.toLowerCase())) throw httpError(400, 'Choose one of the listed options');
  }
  stmt.upsertCustomAnswer.run({
    id: nanoid(12), pool_id: poolId, bet_id: betId, player_id: playerId, answer: a.slice(0, 80), updated_at: now(),
  });
  return stmt.customBetById.get(betId);
}

// Winner/loser of a finished match (penalties break knockout draws).
function winnerOf(m) {
  if (m.status !== 'final' || m.home == null || m.away == null) return null;
  if (m.home_score > m.away_score) return m.home;
  if (m.home_score < m.away_score) return m.away;
  return m.pen_winner || null;
}
function loserOf(m) {
  const w = winnerOf(m);
  if (!w) return null;
  return w === m.home ? m.away : m.home;
}

/**
 * Resolve knockout team slots from group standings + finished KO matches.
 * Idempotent: KO sides are reset and recomputed from scratch, so correcting an
 * upstream result cleanly re-routes everything downstream.
 */
export function resolveKnockouts(poolId) {
  const teams = getFixtures().teams;
  const matches = stmt.matchesByPool.all(poolId);
  // DB rows expose the group as `group_name`; the standings helper wants `group`.
  const standings = computeGroupStandings(teams, matches.map((m) => ({ ...m, group: m.group_name })));
  const thirds = selectBestThirds(standings); // null until all groups complete

  const slot = new Map();
  for (const [g, rows] of standings) {
    if (rows[0]?.complete) {
      slot.set(`1${g}`, rows[0].team);
      slot.set(`2${g}`, rows[1].team);
    }
  }
  if (thirds) thirds.forEach((t, i) => slot.set(`3-${i + 1}`, t.team));

  const byNum = new Map(matches.map((m) => [m.num, m]));
  const resolveSource = (src) => {
    if (!src) return null;
    if (src.startsWith('WM:')) return winnerOf(byNum.get(Number(src.slice(3))));
    if (src.startsWith('LM:')) return loserOf(byNum.get(Number(src.slice(3))));
    return slot.get(src) ?? null;
  };

  // Reset KO sides, then fill in stage order so later rounds see earlier winners.
  const order = ['R32', 'R16', 'QF', 'SF', 'TP', 'F'];
  for (const m of matches) {
    if (m.stage === 'group') continue;
    m.home = null;
    m.away = null;
  }
  for (const stage of order) {
    for (const m of matches) {
      if (m.stage !== stage) continue;
      m.home = resolveSource(m.home_source);
      m.away = resolveSource(m.away_source);
      stmt.updateMatchTeams.run({ id: m.id, home: m.home, away: m.away, updated_at: now() });
    }
  }
}

function maybeFinishPool(poolId) {
  const final = stmt.matchByNum.get(poolId, 104);
  if (final && final.status === 'final') stmt.setPoolStatus.run({ id: poolId, status: 'finished' });
}

// ── state assembly for clients ──
export function sourceLabel(src) {
  if (!src) return null;
  if (src.startsWith('WM:')) return `Winner of Match ${src.slice(3)}`;
  if (src.startsWith('LM:')) return `Loser of Match ${src.slice(3)}`;
  if (src.startsWith('3-')) return `Best 3rd #${src.slice(2)}`;
  const pos = src[0] === '1' ? 'Winner' : 'Runner-up';
  return `${pos} Group ${src.slice(1)}`;
}

export function buildState(poolId, viewerId = null) {
  const pool = getPoolById(poolId);
  if (!pool) return null;
  const rules = parseRules(pool);
  const teams = getFixtures().teams;
  const players = stmt.playersByPool.all(poolId);
  const rawMatches = stmt.matchesByPool.all(poolId);
  const predictions = stmt.predsByPool.all(poolId);

  const matches = rawMatches.map((m) => {
    const ls = lockState(m);
    return {
      num: m.num,
      stage: m.stage,
      round: m.round,
      group: m.group_name,
      matchday: m.matchday,
      home: m.home,
      away: m.away,
      homeLabel: m.home || sourceLabel(m.home_source),
      awayLabel: m.away || sourceLabel(m.away_source),
      kickoff: m.kickoff,
      homeScore: m.home_score,
      awayScore: m.away_score,
      penWinner: m.pen_winner,
      status: ls.status,
      locked: ls.locked,
    };
  });
  const numById = new Map(rawMatches.map((m) => [m.id, m.num]));

  // viewer's own predictions (all matches) + the running-bets feed.
  // Picks are fully open: everyone sees everyone's predictions for every match.
  const myPredictions = {};
  const revealed = {};
  for (const p of predictions) {
    const num = numById.get(p.match_id);
    if (viewerId && p.player_id === viewerId) {
      myPredictions[num] = { home: p.home_pred, away: p.away_pred, points: p.points };
    }
    (revealed[num] ||= []).push({
      playerId: p.player_id,
      home: p.home_pred,
      away: p.away_pred,
      points: p.points,
    });
  }

  // custom (pool-level) bets + everyone's answers, plus per-player custom points
  const betRows = stmt.customBetsByPool.all(poolId);
  const answerRows = stmt.answersByPool.all(poolId);
  const customPoints = computeCustomPoints(betRows, answerRows);
  const answersByBet = new Map();
  for (const a of answerRows) {
    if (!answersByBet.has(a.bet_id)) answersByBet.set(a.bet_id, []);
    answersByBet.get(a.bet_id).push({ playerId: a.player_id, answer: a.answer });
  }
  const customBets = betRows.map((b) => ({
    id: b.id,
    question: b.question,
    options: b.options ? JSON.parse(b.options) : null,
    points: b.points,
    answer: b.answer,
    status: b.answer != null ? 'settled' : 'open',
    answers: answersByBet.get(b.id) || [],
  }));
  const myCustomAnswers = {};
  if (viewerId) for (const a of answerRows) if (a.player_id === viewerId) myCustomAnswers[a.bet_id] = a.answer;

  const leaderboard = buildLeaderboard(players, predictions, rawMatches.map((m) => ({
    id: m.id, stage: m.stage, status: m.status, home_score: m.home_score, away_score: m.away_score,
  })), rules, customPoints);

  const pot = buildPot(pool, players, leaderboard);

  return {
    pool: {
      id: pool.id,
      code: pool.code,
      name: pool.name,
      buyIn: pool.buy_in,
      currency: pool.currency,
      rules,
      status: pool.status,
      synced: !!pool.synced,
      createdAt: pool.created_at,
    },
    teams,
    matches,
    players: players.map((p) => ({
      id: p.id,
      name: p.display_name,
      isHost: !!p.is_host,
      paid: !!p.paid,
      seq: p.seq,
    })),
    leaderboard,
    pot,
    myPredictions,
    revealed,
    customBets,
    myCustomAnswers,
    serverTime: now(),
  };
}

function computeCustomPoints(bets, answers) {
  const byPlayer = {};
  const ansByBet = new Map();
  for (const a of answers) {
    if (!ansByBet.has(a.bet_id)) ansByBet.set(a.bet_id, []);
    ansByBet.get(a.bet_id).push(a);
  }
  for (const bet of bets) {
    if (bet.answer == null) continue;
    const win = String(bet.answer).trim().toLowerCase();
    for (const a of ansByBet.get(bet.id) || []) {
      if (String(a.answer).trim().toLowerCase() === win) {
        byPlayer[a.player_id] = (byPlayer[a.player_id] || 0) + bet.points;
      }
    }
  }
  return byPlayer;
}

function buildPot(pool, players, leaderboard) {
  const contributors = players.map((p) => ({ playerId: p.id, name: p.display_name, paid: !!p.paid }));
  const total = players.length * pool.buy_in;
  const paidTotal = players.filter((p) => p.paid).length * pool.buy_in;
  const leader = leaderboard[0];
  const projectedWinner = leader && leader.points > 0 ? { playerId: leader.playerId, name: leader.name, points: leader.points } : null;
  return {
    total,
    paidTotal,
    currency: pool.currency,
    buyIn: pool.buy_in,
    contributors,
    projectedWinner,
  };
}

export function pot(poolId) {
  const state = buildState(poolId);
  return state?.pot;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
export { httpError };
