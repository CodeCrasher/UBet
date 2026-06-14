import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signHostToken, verifyHostToken, hashPin, verifyPin, newToken } from '../../server/auth.js';
import { checkLimit, recordFail, recordSuccess } from '../../server/ratelimit.js';

test('host token verifies for its pool and rejects others', () => {
  const { token } = signHostToken('pool-1');
  assert.equal(verifyHostToken('pool-1', token), true);
  assert.equal(verifyHostToken('pool-2', token), false, 'token is pool-scoped');
});

test('expired host token is rejected', () => {
  const { token } = signHostToken('pool-1', -1000); // already expired
  assert.equal(verifyHostToken('pool-1', token), false);
});

test('tampered host token is rejected', () => {
  const { token } = signHostToken('pool-1');
  const bad = token.slice(0, -2) + (token.endsWith('00') ? '11' : '00');
  assert.equal(verifyHostToken('pool-1', bad), false);
  assert.equal(verifyHostToken('pool-1', ''), false);
});

test('PIN hashing round-trips and rejects wrong PIN', () => {
  const { hash, salt } = hashPin('2026');
  assert.equal(verifyPin('2026', hash, salt), true);
  assert.equal(verifyPin('0000', hash, salt), false);
  assert.equal(verifyPin('', hash, salt), false);
});

test('tokens are unique-ish and long', () => {
  assert.notEqual(newToken(), newToken());
  assert.ok(newToken().length >= 32);
});

test('rate limiter locks out after repeated failures and resets on success', () => {
  const key = 'test-key-1';
  for (let i = 0; i < 5; i++) {
    assert.equal(checkLimit(key).allowed, true, `attempt ${i} allowed`);
    recordFail(key, { max: 5, windowMs: 120_000, lockMs: 300_000 });
  }
  const blocked = checkLimit(key);
  assert.equal(blocked.allowed, false, 'locked after 5 fails');
  assert.ok(blocked.retryAfter > 0);
  recordSuccess(key);
  assert.equal(checkLimit(key).allowed, true, 'success clears the lock');
});
