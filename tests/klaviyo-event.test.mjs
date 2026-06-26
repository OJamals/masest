import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEventPayload } from '../functions/_lib/klaviyo.js';

test('buildEventPayload shapes a Klaviyo metric event', () => {
  const p = buildEventPayload({ email: 'a@b.co', metric: 'Deal Stage Changed', value: 1200, properties: { stage: 'proposal' } });
  assert.equal(p.data.type, 'event');
  assert.equal(p.data.attributes.metric.data.attributes.name, 'Deal Stage Changed');
  assert.equal(p.data.attributes.profile.data.attributes.email, 'a@b.co');
  assert.equal(p.data.attributes.value, 1200);
  assert.equal(p.data.attributes.properties.stage, 'proposal');
});

test('buildEventPayload omits a non-numeric value', () => {
  const p = buildEventPayload({ email: 'a@b.co', metric: 'X' });
  assert.equal(p.data.attributes.value, undefined);
});
