import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFields } from '../functions/_lib/crm-contacts.js';

test('mergeFields fills only the survivor blanks from the duplicate', () => {
  const out = mergeFields({ title: 'Buyer', email: '', phone: null }, { title: 'Manager', email: 'x@y.co', phone: '555' });
  assert.deepEqual(out, { email: 'x@y.co', phone: '555' }); // title kept; blank email/phone filled
});

test('mergeFields never overwrites an existing value + ignores blank loser fields', () => {
  assert.deepEqual(mergeFields({ email: 'a@b.co' }, { email: 'c@d.co' }), {});
  assert.deepEqual(mergeFields({ email: '' }, { email: '   ' }), {});
  assert.deepEqual(mergeFields({}, {}), {});
});
