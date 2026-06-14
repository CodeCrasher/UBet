import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : join(PROJECT_ROOT, 'data', 'ubet.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// One-time migration off the pre-pivot schema: the old per-room model had a
// `pools` table with a totally different shape. If an existing volume DB still
// has it, drop the obsolete tables so the new schema can be created cleanly.
// (Detected by the absence of the new `type` column on `pools`.)
const legacyPools = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pools'").get();
if (legacyPools) {
  const cols = db.prepare('PRAGMA table_info(pools)').all();
  if (!cols.some((c) => c.name === 'type')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE IF EXISTS predictions;
      DROP TABLE IF EXISTS custom_answers;
      DROP TABLE IF EXISTS custom_bets;
      DROP TABLE IF EXISTS players;
      DROP TABLE IF EXISTS matches;
      DROP TABLE IF EXISTS pools;
    `);
    db.pragma('foreign_keys = ON');
  }
}

// All money is whole Rs (INTEGER). One global tournament; pre-seeded pools.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    pw_hash       TEXT NOT NULL,
    pw_salt       TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    balance       INTEGER NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,            -- opaque cookie token
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fixtures (
    num           INTEGER PRIMARY KEY,         -- 1..104
    stage         TEXT NOT NULL,
    round         TEXT NOT NULL,
    group_name    TEXT,
    matchday      INTEGER,
    home          TEXT,                        -- team code, null until KO resolves
    away          TEXT,
    home_source   TEXT,
    away_source   TEXT,
    knockout      INTEGER NOT NULL DEFAULT 0,
    kickoff       TEXT NOT NULL,
    home_score    INTEGER,                     -- ET score excl. penalties
    away_score    INTEGER,
    pen_winner    TEXT,                        -- team code if KO decided on pens
    status        TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | live | final
    settled       INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS live_state (
    fixture_num   INTEGER PRIMARY KEY REFERENCES fixtures(num) ON DELETE CASCADE,
    home_goals    INTEGER NOT NULL DEFAULT 0,
    away_goals    INTEGER NOT NULL DEFAULT 0,
    minute        INTEGER NOT NULL DEFAULT 0,
    phase         TEXT NOT NULL DEFAULT 'NOT_STARTED', -- NOT_STARTED|FIRST_HALF|HALFTIME|SECOND_HALF|ET|PENS|FULL_TIME
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pools (
    id            TEXT PRIMARY KEY,            -- {fixtureNum}:{type}
    fixture_num   INTEGER NOT NULL REFERENCES fixtures(num) ON DELETE CASCADE,
    type          TEXT NOT NULL,               -- WINNER_BIG|EXACT|WINNER_SMALL|TOTAL|MARGIN
    name          TEXT NOT NULL,
    mechanic      TEXT NOT NULL,
    fee           INTEGER NOT NULL,
    rake          REAL NOT NULL DEFAULT 0,
    cap           INTEGER,                     -- null = no cap
    status        TEXT NOT NULL DEFAULT 'open', -- open | locked | settled
    settled_at    TEXT,
    UNIQUE (fixture_num, type)
  );

  CREATE TABLE IF NOT EXISTS entries (
    id            TEXT PRIMARY KEY,
    pool_id       TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    fixture_num   INTEGER NOT NULL,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pred          TEXT NOT NULL,               -- JSON prediction
    fee           INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active', -- active | won | lost | refunded
    correct       INTEGER NOT NULL DEFAULT 0,
    payout        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    UNIQUE (pool_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS ledger (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fixture_num   INTEGER,
    pool_id       TEXT,
    kind          TEXT NOT NULL,               -- entry | winnings | refund | grant
    amount        INTEGER NOT NULL,            -- signed: entry negative, credits positive
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_pools_fixture ON pools(fixture_num);
  CREATE INDEX IF NOT EXISTS idx_entries_pool ON entries(pool_id);
  CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_entries_fixture ON entries(fixture_num);
  CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);
`);

export default db;
export { DB_PATH };
