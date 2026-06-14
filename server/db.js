import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Default DB location is project-relative (one level above /server), so the
// server works regardless of the current working directory it's launched from.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : join(PROJECT_ROOT, 'data', 'ubet.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS pools (
    id            TEXT PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    buy_in        REAL NOT NULL DEFAULT 0,
    currency      TEXT NOT NULL DEFAULT 'USD',
    rules         TEXT NOT NULL,            -- JSON scoring rules
    pin_hash      TEXT NOT NULL,
    pin_salt      TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'live',  -- live | finished
    synced        INTEGER NOT NULL DEFAULT 0,    -- 1 ⇒ results auto-sync from a provider
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS players (
    id            TEXT PRIMARY KEY,
    pool_id       TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    display_name  TEXT NOT NULL,
    token         TEXT NOT NULL UNIQUE,
    is_host       INTEGER NOT NULL DEFAULT 0,
    paid          INTEGER NOT NULL DEFAULT 0,
    seq           INTEGER NOT NULL,         -- join order within pool (tiebreaker)
    joined_at     TEXT NOT NULL,
    UNIQUE (pool_id, display_name)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id            TEXT PRIMARY KEY,         -- {poolId}:{num}
    pool_id       TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    num           INTEGER NOT NULL,         -- fixture number 1..104
    stage         TEXT NOT NULL,            -- group | R32 | R16 | QF | SF | TP | F
    round         TEXT NOT NULL,
    group_name    TEXT,
    matchday      INTEGER,
    home          TEXT,                     -- team code, null until resolved
    away          TEXT,
    home_source   TEXT,                     -- slot token for unresolved KO sides
    away_source   TEXT,
    ext_id        TEXT,                     -- provider match id (for live sync)
    kickoff       TEXT NOT NULL,
    home_score    INTEGER,
    away_score    INTEGER,
    pen_winner    TEXT,                     -- team code if KO decided on penalties
    status        TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | live | final
    locked        INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL,
    UNIQUE (pool_id, num)
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id            TEXT PRIMARY KEY,
    pool_id       TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    home_pred     INTEGER NOT NULL,
    away_pred     INTEGER NOT NULL,
    points        INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL,
    UNIQUE (player_id, match_id)
  );

  CREATE TABLE IF NOT EXISTS custom_bets (
    id            TEXT PRIMARY KEY,
    pool_id       TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    question      TEXT NOT NULL,
    options       TEXT,                     -- JSON array of choices, or null for free text
    points        INTEGER NOT NULL DEFAULT 3,
    answer        TEXT,                     -- winning answer; null ⇒ still open
    locks_at      TEXT,                     -- ISO deadline; after it, no more answers
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_answers (
    id            TEXT PRIMARY KEY,
    pool_id       TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    bet_id        TEXT NOT NULL REFERENCES custom_bets(id) ON DELETE CASCADE,
    player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    answer        TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (bet_id, player_id)
  );

  CREATE INDEX IF NOT EXISTS idx_cbets_pool ON custom_bets(pool_id);
  CREATE INDEX IF NOT EXISTS idx_cans_bet ON custom_answers(bet_id);
  CREATE INDEX IF NOT EXISTS idx_cans_player ON custom_answers(player_id);
  CREATE INDEX IF NOT EXISTS idx_players_pool ON players(pool_id);
  CREATE INDEX IF NOT EXISTS idx_matches_pool ON matches(pool_id);
  CREATE INDEX IF NOT EXISTS idx_pred_pool ON predictions(pool_id);
  CREATE INDEX IF NOT EXISTS idx_pred_match ON predictions(match_id);
  CREATE INDEX IF NOT EXISTS idx_pred_player ON predictions(player_id);
`);

// Lightweight migrations for databases created before these columns existed.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('pools', 'synced', 'synced INTEGER NOT NULL DEFAULT 0');
ensureColumn('matches', 'ext_id', 'ext_id TEXT');
ensureColumn('custom_bets', 'locks_at', 'locks_at TEXT');

export default db;
export { DB_PATH };
