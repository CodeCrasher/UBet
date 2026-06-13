import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, 'data', 'fixtures.json');

let cached = null;

function loadSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
}

function isValid(data) {
  return data && Array.isArray(data.teams) && Array.isArray(data.matches) && data.matches.length > 0;
}

/**
 * Resolve the fixture set used to seed every new pool.
 * If FIXTURES_API_URL is set, try it once at boot; on any failure fall back
 * to the committed snapshot so the app is always offline-safe.
 */
export async function initFixtures() {
  if (cached) return cached;
  const url = process.env.FIXTURES_API_URL;
  if (url) {
    try {
      const headers = process.env.FIXTURES_API_KEY
        ? { Authorization: `Bearer ${process.env.FIXTURES_API_KEY}` }
        : {};
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
