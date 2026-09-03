import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prospectEmailHref,
  prospectPhoneHref,
  prospectWebsiteHref,
} from '../js/admin/crm-prospect-account.js';

test('Prospect channel links normalize safe contact destinations', () => {
  assert.equal(prospectEmailHref(' info@example.test '), 'mailto:info%40example.test');
  assert.equal(prospectPhoneHref('(313) 555-0100'), 'tel:+13135550100');
  assert.equal(prospectPhoneHref('+44 20 7946 0958'), 'tel:+442079460958');
  assert.equal(prospectWebsiteHref('example.test'), 'https://example.test/');
  assert.equal(prospectWebsiteHref('http://example.test/path'), 'http://example.test/path');
});

test('Prospect channel links reject malformed or executable destinations', () => {
  assert.equal(prospectEmailHref(''), '');
  assert.equal(prospectPhoneHref('extension only'), '');
  assert.equal(prospectWebsiteHref('javascript:alert(1)'), '');
  assert.equal(prospectWebsiteHref('data:text/html,unsafe'), '');
  assert.equal(prospectWebsiteHref('https://'), '');
});
