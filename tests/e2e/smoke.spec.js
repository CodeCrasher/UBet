import { test, expect } from '@playwright/test';

// Full happy path through the real UI + websockets:
// host creates a pool → friend joins → friend predicts → host enters the
// result → the leaderboard and pot update live for BOTH of them (no reload).
// Runs under the `desktop` and `mobile` projects from playwright.config.js.

// On mobile the leaderboard lives behind the "Table" tab; on desktop it's
// always in the side rail. This helper reveals it either way.
async function showLeaderboard(page) {
  const tab = page.locator('.tabs button', { hasText: 'Table' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}
async function showMatches(page) {
  const tab = page.locator('.tabs button', { hasText: 'Matches' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

test('create → join → predict → result → live leaderboard + pot', async ({ browser }) => {
  // ── Host creates a pool ──
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto('/');
  await host.getByRole('button', { name: 'Create a pool' }).click();
  await host.getByPlaceholder('e.g. Maya').fill('Maya');
  await host.locator('input[type="number"]').first().fill('20'); // buy-in
  await host.getByPlaceholder('4+ digits').fill('4321'); // host PIN
  await host.getByRole('button', { name: /Create pool/ }).click();

  // pool view loads; grab the room code
  const codeEl = host.locator('.codebox .code');
  await expect(codeEl).toBeVisible();
  const code = (await codeEl.textContent()).trim();
  expect(code).toHaveLength(6);

  // ── Friend joins ──
  const friendCtx = await browser.newContext();
  const friend = await friendCtx.newPage();
  await friend.goto('/');
  await friend.locator('input.code-input').fill(code);
  await friend.getByPlaceholder('e.g. Alex').fill('Bob');
  await friend.getByRole('button', { name: /Join pool/ }).click();
  await expect(friend.locator('.codebox .code')).toHaveText(code);

  // pot reflects 2 buy-ins of 20 for both of them, pushed live
  await expect(host.locator('.pot-value')).toContainText('40');
  await expect(friend.locator('.pot-value')).toContainText('40');

  // ── Friend predicts the first Matchday 3 fixture: 2–1 ──
  await showMatches(friend);
  await friend.locator('.chip', { hasText: 'Matchday 3' }).click();
  const fCard = friend.locator('.match').first();
  const homeStepper = fCard.locator('.predict-row .stepper').nth(0);
  const awayStepper = fCard.locator('.predict-row .stepper').nth(1);
  await homeStepper.getByRole('button', { name: 'increase' }).click();
  await homeStepper.getByRole('button', { name: 'increase' }).click();
  await Promise.all([
    friend.waitForResponse((r) => r.url().includes('/predictions') && r.request().method() === 'POST'),
    awayStepper.getByRole('button', { name: 'increase' }).click(),
  ]);
  // pick registered as 2–1
  await expect(homeStepper.locator('.val')).toHaveText('2');
  await expect(awayStepper.locator('.val')).toHaveText('1');

  // ── Host enters the same scoreline 2–1 on that fixture ──
  await showMatches(host);
  await host.locator('.chip', { hasText: 'Matchday 3' }).click();
  const hCard = host.locator('.match').first();
  await hCard.locator('.host-entry input').nth(0).fill('2');
  await hCard.locator('.host-entry input').nth(1).fill('1');
  await Promise.all([
    host.waitForResponse((r) => r.url().includes('/results') && r.request().method() === 'POST'),
    hCard.locator('.host-entry').getByRole('button', { name: /Save result|Update/ }).click(),
  ]);
  await expect(hCard).toContainText('Final');

  // ── Bob's exact 2–1 prediction = 10 points (exact 5 + result 3 + over/under 2),
  //    live on both clients ──
  await showLeaderboard(host);
  await expect(host.locator('.lb-row', { hasText: 'Bob' }).locator('.lb-pts .p')).toHaveText('10');

  await showLeaderboard(friend); // friend never reloaded — this is the live push
  await expect(friend.locator('.lb-row', { hasText: 'Bob' }).locator('.lb-pts .p')).toHaveText('10');

  await hostCtx.close();
  await friendCtx.close();
});
