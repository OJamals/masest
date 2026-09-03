import assert from 'node:assert/strict';
import test from 'node:test';
import { shipmentNotice } from '../functions/_lib/order-email.js';

test('packing notice does not claim a carrier label already exists', () => {
  const notice = shipmentNotice('packing');
  assert.equal(notice.label, 'packing');
  assert.doesNotMatch(notice.body, /label has been created/i);
  assert.match(notice.body, /prepared for shipment/i);
});

test('delivered notice works for guests without promising an account dashboard', () => {
  const notice = shipmentNotice('delivered');
  assert.doesNotMatch(notice.body, /dashboard/i);
  assert.match(notice.body, /short or damaged/i);
});
