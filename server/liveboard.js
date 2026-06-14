import db from './db.js';
import { getFixture, setFixtureStatus } from './tournament.js';
import { now, httpError } from './util.js';

const PHASES = ['NOT_STARTED', 'FIRST_HALF', 'HALFTIME', 'SECOND_HALF', 'ET', 'PENS', 'FULL_TIME'];

const stmt = {
  upsert: db.prepare(`INSERT INTO live_state (fixture_num, home_goals, away_goals, minute, phase, updated_at)
    VALUES (@fixture_num, @home_goals, @away_goals, @minute, @phase, @updated_at)
    ON CONFLICT(fixture_num) DO UPDATE SET home_goals=@home_goals, away_goals=@away_goals, minute=@minute, phase=@phase, updated_at=@updated_at`),
};

export function setLiveScore({ fixtureNum, homeGoals, awayGoals, minute, phase }) {
  const fixture = getFixture(fixtureNum);
  if (!fixture) throw httpError(404, 'Fixture not found');
  if (fixture.status === 'final') throw httpError(409, 'Fixture is already final');
  const hg = Math.max(0, Math.min(60, Number(homeGoals) || 0));
  const ag = Math.max(0, Math.min(60, Number(awayGoals) || 0));
  const min = Math.max(0, Math.min(150, Number(minute) || 0));
  const ph = PHASES.includes(phase) ? phase : 'SECOND_HALF';
  stmt.upsert.run({ fixture_num: fixtureNum, home_goals: hg, away_goals: ag, minute: min, phase: ph, updated_at: now() });
  if (fixture.status !== 'live') setFixtureStatus(fixtureNum, 'live');
  return { fixtureNum, homeGoals: hg, awayGoals: ag, minute: min, phase: ph };
}
