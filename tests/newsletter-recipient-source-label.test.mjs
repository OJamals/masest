import test from 'node:test';
import assert from 'node:assert/strict';

import { recipientSourceLabel } from '../js/admin/newsletter.js';

test('newsletter recipient sources use provider-neutral labels', () => {
  assert.equal(recipientSourceLabel('historical_vendor_migration'), 'Imported contact');
  assert.equal(recipientSourceLabel('account_migration'), 'Imported contact');
  assert.equal(recipientSourceLabel('footer_newsletter'), 'Website signup');
  assert.equal(recipientSourceLabel('manual_import'), 'Manual import');
  assert.equal(recipientSourceLabel(''), '—');
});
