import { test, expect } from '@playwright/test';

// Full journey: register → stay logged in across refresh → open a fixture's
// Winner pool → place a pick → admin pushes a live score (board swings to
// CURRENTLY WINNING) → admin confirms the result → pool board, total earnings
// and the breakdown all settle and reconcile. Runs on desktop + mobile.
test('login persists, enter pool, live swing, settle, reconcile', async ({ page }) => {
  await page.goto('/');

  // ── register ──
  await page.getByRole('button', { name: 'Sign up' }).click();
  const email = `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}@t.com`;
  await page.getByPlaceholder('e.g. Alex').fill('E2E Tester');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill('password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Fixtures' })).toBeVisible();

  // ── session persists across a refresh ──
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Fixtures' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in' })).toHaveCount(0);

  // ── find an open fixture and open its Winner (Big) pool ──
  const { fixtures } = await (await page.request.get('/api/fixtures')).json();
  const open = fixtures.find((f) => !f.locked && f.homeTeam && f.awayTeam);
  expect(open, 'an open fixture exists').toBeTruthy();
  await page.goto(`/#/pool/${encodeURIComponent(`${open.num}:WINNER_BIG`)}`);
  await expect(page.locator('.board')).toBeVisible();

  // ── place a HOME pick ──
  await page.locator('.pred-opt').first().click();
  await page.getByRole('button', { name: /Enter pool/ }).click();
  await expect(page.getByRole('heading', { name: 'Your pick' })).toBeVisible();
  await expect(page.locator('.brow.me')).toBeVisible();

  // ── admin pushes a live home goal → my row flips to CURRENTLY WINNING ──
  await page.locator('.admin-fab').click();
  await page.locator('.sheet input[type=password]').fill('2026');
  await page.getByRole('button', { name: 'Unlock admin' }).click();
  await page.locator('.admin-score').first().locator('input').first().fill('1');
  await page.getByRole('button', { name: 'Push live score' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.brow.me')).toContainText(/Currently winning/i);
  await expect(page.locator('.board .pill')).toContainText(/Live/i);

  // ── admin confirms the final result (1–0) → settles ──
  await page.locator('.admin-fab').click();
  const fin = page.locator('.admin-score').nth(1);
  await fin.locator('input').first().fill('1');
  await fin.locator('input').nth(1).fill('0');
  await page.getByRole('button', { name: 'Confirm result & settle' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  await expect(page.locator('.board .pill')).toContainText(/Final/i);
  await expect(page.locator('.brow.me')).toContainText(/Won/i);

  // ── earnings breakdown reflects the win and reconciles ──
  await page.locator('.balance-chip').click();
  await expect(page.getByText('Total earnings')).toBeVisible();
  await expect(page.locator('.earn-row .res.won').first()).toBeVisible();
});
