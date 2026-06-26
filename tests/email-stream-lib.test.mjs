import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryStream, filterByStream, unsubscribeToken, verifyUnsubscribeToken } from '../functions/_lib/email.js';

test('categoryStream classifies marketing vs transactional', () => {
  assert.equal(categoryStream('offer'), 'marketing');
  assert.equal(categoryStream('lead_followup'), 'marketing');
  assert.equal(categoryStream('lead_followup_reminder'), 'marketing');
  assert.equal(categoryStream('order'), 'transactional');
  assert.equal(categoryStream('billing'), 'transactional');
  assert.equal(categoryStream('lead_autoreply'), 'transactional'); // expected response, not marketing
  assert.equal(categoryStream(null), 'transactional');
});

test('filterByStream: hard block hides everything, marketing block only marketing', () => {
  const map = new Map([
    ['hard@x.co', new Set(['all'])],
    ['unsub@x.co', new Set(['marketing'])],
  ]);
  // marketing send drops both the hard-blocked and the marketing-unsubscribed
  assert.deepEqual(filterByStream(['hard@x.co', 'unsub@x.co', 'ok@x.co'], 'offer', map), ['ok@x.co']);
  // transactional send: the marketing unsubscriber STILL gets it; only the hard block is dropped
  assert.deepEqual(filterByStream(['hard@x.co', 'unsub@x.co', 'ok@x.co'], 'order', map), ['unsub@x.co', 'ok@x.co']);
});

test('unsubscribe token round-trips (case-insensitive) + rejects tampering', async () => {
  const tok = await unsubscribeToken('A@B.co', 'secret');
  assert.equal(await verifyUnsubscribeToken('a@b.co', tok, 'secret'), true);
  assert.equal(await verifyUnsubscribeToken('other@b.co', tok, 'secret'), false);
  assert.equal(await verifyUnsubscribeToken('a@b.co', 'deadbeef', 'secret'), false);
  assert.equal(await verifyUnsubscribeToken('a@b.co', tok, 'wrong-secret'), false);
});
