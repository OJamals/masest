// Buyers compare shipping options on "when does it land", not "how many transit days".
// These pin the date derivation, including the cases where a naive +N days would lie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalLabel, businessDaysFromNow } from '../js/checkout.js';

// Thursday 2026-08-06.
const THU = new Date('2026-08-06T12:00:00Z');

test('business-day projection steps over the weekend', () => {
  // Thu + 1 = Fri.
  assert.equal(businessDaysFromNow(1, THU).getUTCDate(), 7);
  // Thu + 2 must be Monday the 10th, not Saturday the 8th.
  const twoDays = businessDaysFromNow(2, THU);
  assert.equal(twoDays.getUTCDate(), 10);
  assert.notEqual(twoDays.getUTCDay(), 0);
  assert.notEqual(twoDays.getUTCDay(), 6);
  // A full week of transit lands the following Thursday, having skipped two weekend days.
  assert.equal(businessDaysFromNow(5, THU).getUTCDate(), 13);
});

test('business-day projection rejects values that cannot describe a delivery', () => {
  for (const value of [0, -3, null, undefined, NaN, 'soon']) {
    assert.equal(businessDaysFromNow(value, THU), null, String(value));
  }
});

test('the carrier estimate wins over the transit-day fallback', () => {
  const label = arrivalLabel(
    { estimated_delivery_date: '2026-08-11T00:00:00Z', delivery_days: 99 },
    THU,
  );
  // 99 transit days would say December; the carrier said the 11th.
  assert.match(label, /Aug 11/);
  assert.match(label, /^Arrives /);
});

test('near-term arrivals read as words, not dates', () => {
  assert.equal(arrivalLabel({ estimated_delivery_date: '2026-08-07T12:00:00Z' }, THU), 'Arrives tomorrow');
  assert.equal(arrivalLabel({ estimated_delivery_date: '2026-08-06T18:00:00Z' }, THU), 'Arrives today');
  // A date already past still reads as today rather than a negative countdown.
  assert.equal(arrivalLabel({ estimated_delivery_date: '2026-08-04T12:00:00Z' }, THU), 'Arrives today');
});

test('a rate with no usable estimate yields no date rather than a fabricated one', () => {
  assert.equal(arrivalLabel({}, THU), null);
  assert.equal(arrivalLabel({ delivery_days: null }, THU), null);
  assert.equal(arrivalLabel({ estimated_delivery_date: 'not-a-date' }, THU), null);
});

test('the rendered label carries a weekday so the date is scannable', () => {
  // "Arrives Tue, Aug 11" — the weekday is what a buyer actually plans around.
  const label = arrivalLabel({ estimated_delivery_date: '2026-08-11T00:00:00Z' }, THU);
  assert.match(label, /Arrives \w{3}, \w{3} \d{1,2}/);
});
