import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMAIL_CATEGORY_POLICY,
  MARKETING_CATEGORIES,
  categoryPolicy,
  categoryStream,
} from '../functions/_lib/email-policy.js';

test('email category policy owns provider + preference semantics', () => {
  assert.deepEqual(categoryPolicy('order'), {
    stream: 'transactional', provider: 'cloudflare', preference: null,
  });
  assert.deepEqual(categoryPolicy('newsletter'), {
    stream: 'marketing', provider: 'klaviyo', preference: 'marketing_email_enabled',
  });
  assert.equal(categoryPolicy('unknown'), null);
  assert.equal(categoryPolicy(null), null);
  assert.equal(categoryStream('offer'), 'marketing');
  assert.equal(categoryStream('lead_followup'), 'transactional');
  assert.equal(categoryStream('lead_followup_reminder'), 'transactional');
  assert.equal(categoryStream('billing'), 'transactional');
  assert.equal(categoryStream('unknown'), null);
  assert.ok(MARKETING_CATEGORIES.has('review_request'));
  assert.equal(Object.isFrozen(EMAIL_CATEGORY_POLICY), true);
});
