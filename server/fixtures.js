import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fixturesCache = null;
let poolTypesCache = null;

// Committed WC 2026 fixture snapshot (48 teams, 12 groups, 104 matches).
// Regenerate with `npm run build:fixtures`. A live fixtures feed could replace
// this at boot; admin entry is the authoritative path for scores/results.
export function getFixtures() {
  if (!fixturesCache) {
    fixturesCache = JSON.parse(readFileSync(join(__dirname, 'data', 'fixtures.json'), 'utf8'));
  }
  return fixturesCache;
}

// Drop the in-memory snapshot so the next getFixtures() re-reads fixtures.json
// from disk (used by the admin resync to pick up a freshly-built schedule).
export function invalidateFixturesCache() {
  fixturesCache = null;
}

// Data-driven pool definitions (type, fee, mechanic, cap, rake).
export function getPoolTypes() {
  if (!poolTypesCache) {
    poolTypesCache = JSON.parse(readFileSync(join(__dirname, 'data', 'pool-types.json'), 'utf8'));
  }
  return poolTypesCache;
}

export function teamMap() {
  const m = new Map();
  for (const t of getFixtures().teams) m.set(t.code, t);
  return m;
}
