import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, 'data', 'fixtures.json');
const SYNCED_PATH = join(__dirname, 'data', 'fixtures.synced.json');

let cached = null;

function loadSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
}

function isValid(data) {
  return data && Array.isArray(data.teams) && Array.isArray(data.matches) && data.matches.length > 0;
}

export function loadSyncedIfAny() {
  try {
    if (existsSync(SYNCED_PATH)) return JSON.parse(readFileSync(SYNCED_PATH, 'utf8'));
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

/**
 * Replace the active fixture set (used when the live-sync layer produces a new
 * canonical tournament). Persisted so a restart keeps the last real data until
 * the next sync runs.
 */
export function setFixtures(data) {
  if (!isValid(data)) return;
  cached = data;
  if (data.__synced) {
    try {
      writeFileSync(SYNCED_PATH, JSON.stringify(data, null, 2) + '\n');
    } catch (e) {
      console.warn('Could not persist synced fixtures:', e.message);
    }
  }
}

/**
 * Resolve the fixture set used to seed every new pool.
 * Priority: persisted synced data (if a provider is configured) →
 * FIXTURES_API_URL (same JSON shape) → committed offline snapshot.
 */
export async function initFixtures() {
  if (cached) return cached;

  if (process.env.SYNC_PROVIDER) {
    const synced = loadSyncedIfAny();
    if (isValid(synced)) {
      cached = synced;
      console.log(`✓ Loaded ${synced.matches.length} synced fixtures (${synced.provider || 'cache'})`);
      return cached;
    }
  }

  const url = process.env.FIXTURES_API_URL;
  if (url) {
    try {
      const headers = process.env.FIXTURES_API_KEY ? { Authorization: `Bearer ${process.env.FIXTURES_API_KEY}` } : {};
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!isValid(data)) throw new Error('unexpected shape');
      cached = data;
      console.log(`✓ Loaded ${data.matches.length} fixtures from FIXTURES_API_URL`);
      return cached;
    } catch (err) {
      console.warn(`⚠ FIXTURES_API_URL failed (${err.message}); using committed snapshot`);
    }
  }

  cached = loadSnapshot();
  return cached;
}

export function getFixtures() {
  if (!cached) cached = loadSnapshot();
  return cached;
}
