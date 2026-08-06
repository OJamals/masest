// Buyers compare shipping options on "when does it land", not "how many transit days".
//
// The split under test: the SERVER decides which day the carrier collects and sends it as
// ship_date, so the carrier's returned estimate already includes handling and its own
// holiday calendar. The CLIENT renders that answer without shifting it again — shifting
// twice would quote every option a day slower than it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATE_DISPLAY_POLICY,
  arrivalLabel,
  arrivalWindow,
  businessDaysFromNow,
  fulfillmentNote,
} from '../js/checkout.js';
import {
  FULFILLMENT_POLICY,
  dispatchDate,
  fulfillmentSummary,
  shipDateString,
} from '../functions/_lib/fulfillment-schedule.js';
import { buildRateRequest } from '../functions/_lib/shipstation.js';

// Thursday 2026-08-06, 12:00 UTC = 08:00 ET — before the 14:00 ET cutoff.
const THU_MORNING = new Date('2026-08-06T12:00:00Z');
// Same day, 19:00 UTC = 15:00 ET — after it.
const THU_AFTERNOON = new Date('2026-08-06T19:00:00Z');
// Friday 21:00 UTC = 17:00 ET — past the cutoff heading into a weekend.
const FRI_EVENING = new Date('2026-08-07T21:00:00Z');

test('dispatch date is the day the carrier can actually collect', () => {
  // Beat the cutoff on Thursday: picked Thursday, collected Friday.
  assert.equal(shipDateString(THU_MORNING), '2026-08-07');
  // Miss it: picking slips a day, so collection is Monday.
  assert.equal(shipDateString(THU_AFTERNOON), '2026-08-10');
  // Friday evening loses the weekend entirely — Mon to pick, Tue to collect.
  assert.equal(shipDateString(FRI_EVENING), '2026-08-11');
});

test('dispatch never lands on a weekend', () => {
  for (const iso of [
    '2026-08-06T12:00:00Z', '2026-08-07T21:00:00Z', '2026-08-08T12:00:00Z',
    '2026-08-09T12:00:00Z', '2026-08-10T12:00:00Z',
  ]) {
    const day = dispatchDate(new Date(iso)).getUTCDay();
    assert.ok(![0, 6].includes(day), `${iso} produced weekday ${day}`);
  }
});

test('same-day dispatch still waits for the warehouse to open', () => {
  // Zero handling and no cutoff, but Saturday: collection is Monday, not Saturday.
  const saturday = new Date('2026-08-08T12:00:00Z');
  const policy = { cutoffHourEt: 24, handlingDays: 0 };
  assert.equal(shipDateString(saturday, policy), '2026-08-10');
  // A weekday under the same policy dispatches that day.
  assert.equal(shipDateString(THU_MORNING, policy), '2026-08-06');
});

test('the cutoff is the warehouse clock, not the buyer clock', () => {
  // 18:00 UTC is 14:00 ET exactly — the cutoff has passed.
  assert.equal(shipDateString(new Date('2026-08-06T18:00:00Z')), '2026-08-10');
  // One minute earlier is still 13:59 ET.
  assert.equal(shipDateString(new Date('2026-08-06T17:59:00Z')), '2026-08-07');
});

test('the rate request carries the dispatch date so the carrier prices from it', () => {
  const order = {
    order_number: 'MA-1', currency: 'usd', customer_email: 'b@x.co',
    ship_address: { name: 'B', phone: '3215550100', address: { line1: '1 Main St', city: 'Melbourne', state: 'FL', postal_code: '32904', country: 'US' } },
    order_items: [{ sku: 'S', name: 'S', qty: 1, unit_price: 10 }],
  };
  const packages = [{ weight: { value: 10, unit: 'pound' } }];
  const withDate = buildRateRequest({ order, packages, warehouseId: 'se-1', carrierIds: ['se-ups'], phone: '3215550100', shipDate: '2026-08-10' });
  assert.equal(withDate.shipment.ship_date, '2026-08-10');
  // Absent or malformed, the field is omitted rather than sent as garbage.
  const without = buildRateRequest({ order, packages, warehouseId: 'se-1', carrierIds: ['se-ups'], phone: '3215550100' });
  assert.ok(!('ship_date' in without.shipment));
  const bad = buildRateRequest({ order, packages, warehouseId: 'se-1', carrierIds: ['se-ups'], phone: '3215550100', shipDate: 'next tuesday' });
  assert.ok(!('ship_date' in bad.shipment));
});

test('the client renders the carrier date without shifting it again', () => {
  // Carrier answered Aug 11 for a shipment collected Aug 10; handling is already inside it.
  const label = arrivalLabel({ estimated_delivery_date: '2026-08-11T00:00:00Z' }, { shipDate: '2026-08-10' });
  assert.equal(label, 'Arrives Tue, Aug 11');
});

test('the transit-day fallback counts from dispatch, not from today', () => {
  // No date from the provider, 2 transit days, collected Monday Aug 10 → Wednesday Aug 12.
  const label = arrivalLabel({ delivery_days: 2 }, { shipDate: '2026-08-10' });
  assert.equal(label, 'Arrives Wed, Aug 12');
  // Without a ship date it can only count from today — still never earlier than tomorrow.
  const window = arrivalWindow({ delivery_days: 1 });
  assert.ok(window.earliest.getTime() > Date.now() - 86400000);
});

test('a date is never fabricated when the provider gave nothing usable', () => {
  assert.equal(arrivalLabel({}, { shipDate: '2026-08-10' }), null);
  assert.equal(arrivalWindow({}, { shipDate: '2026-08-10' }), null);
  assert.equal(arrivalLabel({ delivery_days: null }), null);
  assert.equal(arrivalLabel({ estimated_delivery_date: 'not-a-date' }), null);
});

test('the display buffer is off, and widens into a range when raised', () => {
  assert.equal(DATE_DISPLAY_POLICY.bufferDays, 0);
  const rate = { estimated_delivery_date: '2026-08-11T00:00:00Z' };
  assert.equal(arrivalLabel(rate, { shipDate: '2026-08-10' }), 'Arrives Tue, Aug 11');
  assert.equal(
    arrivalLabel(rate, { shipDate: '2026-08-10', policy: { bufferDays: 2 } }),
    'Arrives Aug 11–13',
  );
  // Across a month boundary both months are spelled out.
  assert.equal(
    arrivalLabel({ estimated_delivery_date: '2026-08-28T00:00:00Z' }, { policy: { bufferDays: 2 } }),
    'Arrives Aug 28 – Sep 1',
  );
});

test('business-day projection skips weekends and rejects nonsense', () => {
  assert.equal(businessDaysFromNow(2, THU_MORNING).getUTCDate(), 10);
  for (const value of [0, -3, null, undefined, NaN, 'soon']) {
    assert.equal(businessDaysFromNow(value, THU_MORNING), null, String(value));
  }
});

test('the buyer-facing note is generated from the same policy the dates used', () => {
  const summary = fulfillmentSummary(THU_MORNING);
  assert.equal(summary.ship_date, '2026-08-07');
  assert.equal(summary.handling_days, FULFILLMENT_POLICY.handlingDays);
  assert.equal(summary.cutoff_hour_et, FULFILLMENT_POLICY.cutoffHourEt);
  const note = fulfillmentNote(summary);
  assert.match(note, /1 business day for order handling/);
  assert.match(note, /after 2:00 PM ET/);
  // A policy with nothing to explain produces no note rather than an empty sentence.
  assert.equal(fulfillmentNote({ handling_days: 0, cutoff_hour_et: 0 }), '');
  assert.equal(fulfillmentNote(), '');
});
