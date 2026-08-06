// Buyers compare shipping options on "when does it land", not "how many transit days".
// A carrier estimate is transit-only and quotes the good case, so what gets shown is that
// estimate pushed out by warehouse handling and widened by a buffer. These pin both the
// date derivation and the policy that shifts it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FULFILLMENT_POLICY,
  arrivalLabel,
  arrivalWindow,
  businessDaysFromNow,
  dispatchDelayBusinessDays,
} from '../js/checkout.js';

// Thursday 2026-08-06, 12:00 UTC = 08:00 ET — before the 14:00 ET cutoff.
const THU_MORNING = new Date('2026-08-06T12:00:00Z');
// Same day, 19:00 UTC = 15:00 ET — after the cutoff.
const THU_AFTERNOON = new Date('2026-08-06T19:00:00Z');
// Policy that disables every adjustment, isolating the raw carrier date.
const RAW = { cutoffHourEt: 24, handlingDays: 0, bufferDays: 0 };

test('business-day projection steps over the weekend', () => {
  assert.equal(businessDaysFromNow(1, THU_MORNING).getUTCDate(), 7);
  // Thu + 2 must be Monday the 10th, not Saturday the 8th.
  const twoDays = businessDaysFromNow(2, THU_MORNING);
  assert.equal(twoDays.getUTCDate(), 10);
  assert.ok(![0, 6].includes(twoDays.getUTCDay()));
  assert.equal(businessDaysFromNow(5, THU_MORNING).getUTCDate(), 13);
});

test('business-day projection rejects values that cannot describe a delivery', () => {
  for (const value of [0, -3, null, undefined, NaN, 'soon']) {
    assert.equal(businessDaysFromNow(value, THU_MORNING), null, String(value));
  }
});

test('ordering after the warehouse cutoff costs a business day', () => {
  assert.equal(dispatchDelayBusinessDays(THU_MORNING), FULFILLMENT_POLICY.handlingDays);
  assert.equal(dispatchDelayBusinessDays(THU_AFTERNOON), FULFILLMENT_POLICY.handlingDays + 1);
  // The cutoff is the warehouse's local time, not the buyer's — same instant, same answer.
  assert.equal(dispatchDelayBusinessDays(new Date('2026-08-06T19:00:00Z')), dispatchDelayBusinessDays(THU_AFTERNOON));
});

test('the shown window is the carrier estimate pushed out by handling and buffer', () => {
  // Carrier says Friday the 7th. One handling day and one buffer day → Mon 10 to Tue 11.
  const window = arrivalWindow({ estimated_delivery_date: '2026-08-07T00:00:00Z' }, THU_MORNING);
  assert.equal(window.earliest.getUTCDate(), 10);
  assert.equal(window.latest.getUTCDate(), 11);
  // Never promises a weekend arrival off the back of a business-day shift.
  assert.ok(![0, 6].includes(window.earliest.getUTCDay()));
  assert.ok(![0, 6].includes(window.latest.getUTCDay()));
});

test('an optimistic next-day estimate is no longer shown as next-day', () => {
  // This is the live case that prompted the rule: UPS Ground quoting ~24h to Melbourne FL.
  const label = arrivalLabel({ estimated_delivery_date: '2026-08-07T23:00:00Z' }, THU_MORNING);
  assert.doesNotMatch(label, /tomorrow|today/);
  assert.equal(label, 'Arrives Aug 10–11');
});

test('zeroing the policy shows the carrier date unmodified', () => {
  const label = arrivalLabel({ estimated_delivery_date: '2026-08-11T00:00:00Z' }, THU_MORNING, RAW);
  assert.equal(label, 'Arrives Tue, Aug 11');
});

test('a window spanning a month boundary spells out both months', () => {
  // Aug 27 + 1 handling = Aug 28 (Fri), + 1 buffer = Aug 31 (Mon) — one month, compact form.
  const within = arrivalLabel({ estimated_delivery_date: '2026-08-27T00:00:00Z' }, THU_MORNING);
  assert.equal(within, 'Arrives Aug 28–31');
  const across = arrivalLabel({ estimated_delivery_date: '2026-08-28T00:00:00Z' }, THU_MORNING);
  assert.equal(across, 'Arrives Aug 31 – Sep 1');
});

test('the carrier estimate wins over the transit-day fallback', () => {
  const label = arrivalLabel(
    { estimated_delivery_date: '2026-08-11T00:00:00Z', delivery_days: 99 },
    THU_MORNING,
  );
  // 99 transit days would say December; the carrier said the 11th.
  assert.match(label, /Aug 1[23]/);
});

test('a rate with no usable estimate yields no date rather than a fabricated one', () => {
  assert.equal(arrivalLabel({}, THU_MORNING), null);
  assert.equal(arrivalWindow({}, THU_MORNING), null);
  assert.equal(arrivalLabel({ delivery_days: null }, THU_MORNING), null);
  assert.equal(arrivalLabel({ estimated_delivery_date: 'not-a-date' }, THU_MORNING), null);
});

test('the window never moves earlier than the carrier estimate', () => {
  for (const iso of ['2026-08-07T00:00:00Z', '2026-08-20T00:00:00Z', '2026-12-31T00:00:00Z']) {
    const window = arrivalWindow({ estimated_delivery_date: iso }, THU_MORNING);
    assert.ok(window.earliest.getTime() >= Date.parse(iso), iso);
    assert.ok(window.latest.getTime() >= window.earliest.getTime(), iso);
  }
});
