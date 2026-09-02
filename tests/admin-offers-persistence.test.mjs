import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/offers.js', import.meta.url), 'utf8');

test('offer persistence succeeds before notifications or Klaviyo events fan out', () => {
  const offerInsert = src.indexOf("sb.from('offers').insert");
  const notificationInsert = src.indexOf("sb.from('notifications').insert");
  const marketingQueue = src.indexOf('queueMarketingEmail(env');
  assert.ok(offerInsert > -1 && notificationInsert > -1 && marketingQueue > -1);
  assert.ok(offerInsert < notificationInsert, 'canonical offer row must exist before in-app fanout');
  assert.ok(offerInsert < marketingQueue, 'canonical offer row must exist before email fanout');
  assert.match(src, /error:\s*offerError/);
  assert.match(src, /if \(offerError \|\| !offer\?\.id\)/);
  assert.doesNotMatch(src, /offer\?\.id \|\| 'unknown'/);
});
