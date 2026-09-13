import assert from 'node:assert/strict';
import test from 'node:test';

import { companyOptions } from '../js/admin/orders.js';

// Options are parsed out of the returned markup with a small reader rather than matched as
// strings, so the assertions are about which businesses are offered and which one is chosen.
function options(html) {
  return [...html.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)]
    .map(([, value, selected, label]) => ({ value, label, selected: Boolean(selected) }));
}

const ACME = { id: '11111111-1111-1111-1111-111111111111', name: 'Acme HVAC' };
const BRIGHT = { id: '22222222-2222-2222-2222-222222222222', name: 'Bright Marine', status: 'approved' };
const PENDING = { id: '33333333-3333-3333-3333-333333333333', name: 'Coastal Labs', status: 'pending' };

test('a guest order offers only the guest choice until a search runs', () => {
  const list = options(companyOptions());
  assert.deepEqual(list.map((o) => o.value), ['']);
  assert.equal(list[0].label, 'No business (guest order)');
  assert.equal(list[0].selected, true, 'with nothing chosen, guest is the explicit selection');
});

test("an order's current business stays selected when the edit form opens", () => {
  const list = options(companyOptions([], { pinned: ACME, selected: ACME.id }));
  assert.deepEqual(list.map((o) => o.value), ['', ACME.id]);
  assert.equal(list.find((o) => o.selected)?.value, ACME.id);
  assert.equal(list[1].label, 'Acme HVAC');
});

test('a search that does not match the current business cannot drop it', () => {
  // The failure this guards: type "bri", clear the box, save — and the order silently
  // becomes a guest order because the rebuilt list no longer contained its business.
  const afterSearch = options(companyOptions([BRIGHT], { pinned: ACME, selected: ACME.id }));
  assert.deepEqual(afterSearch.map((o) => o.value), ['', ACME.id, BRIGHT.id]);
  assert.equal(afterSearch.find((o) => o.selected)?.value, ACME.id);

  const afterClearing = options(companyOptions([], { pinned: ACME, selected: ACME.id }));
  assert.equal(afterClearing.find((o) => o.selected)?.value, ACME.id);
});

test('a business chosen from results stays chosen while the next results still include it', () => {
  const list = options(companyOptions([BRIGHT, PENDING], { pinned: ACME, selected: BRIGHT.id }));
  assert.equal(list.find((o) => o.selected)?.value, BRIGHT.id);
  // Pick Bright, search again for something that excludes it: the selection must return to
  // the order's own business, not to guest, or saving would strip the business.
  const gone = options(companyOptions([PENDING], { pinned: ACME, selected: BRIGHT.id }));
  assert.equal(gone.find((o) => o.selected)?.value, ACME.id, 'falls back to the pinned business');
  // On the create form there is no pinned business, so the same case falls back to guest.
  const unpinned = options(companyOptions([PENDING], { selected: BRIGHT.id }));
  assert.equal(unpinned.find((o) => o.selected)?.value, '', 'with nothing pinned it falls back to guest');
});

test('the pinned business is not listed twice when a search also returns it', () => {
  const list = options(companyOptions([{ ...ACME, status: 'approved' }, BRIGHT], { pinned: ACME, selected: ACME.id }));
  assert.equal(list.filter((o) => o.value === ACME.id).length, 1);
});

test('unapproved businesses are labelled, approved ones and pinned ones are not', () => {
  const list = options(companyOptions([BRIGHT, PENDING, { id: 'x-1', name: 'No Status Co' }]));
  assert.equal(list.find((o) => o.value === BRIGHT.id).label, 'Bright Marine');
  assert.equal(list.find((o) => o.value === PENDING.id).label, 'Coastal Labs (pending)');
  assert.equal(list.find((o) => o.value === 'x-1').label, 'No Status Co', 'a missing status is not rendered as "(undefined)"');
});

test('business names and ids are escaped', () => {
  const html = companyOptions([{ id: 'a"b', name: '<script>alert(1)</script>' }]);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /value="a"b"/);
});
