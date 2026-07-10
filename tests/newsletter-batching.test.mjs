import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { newsletterBatchPlan } from '../functions/_lib/newsletter.js';

test('newsletterBatchPlan advances capped audiences without dropping the remainder', () => {
  assert.deepEqual(newsletterBatchPlan(1201, 0, 500), { start: 0, end: 500, nextOffset: 500, capped: true });
  assert.deepEqual(newsletterBatchPlan(1201, 500, 500), { start: 500, end: 1000, nextOffset: 1000, capped: true });
  assert.deepEqual(newsletterBatchPlan(1201, 1000, 500), { start: 1000, end: 1201, nextOffset: 1201, capped: false });
});

test('newsletter endpoint reschedules capped batches instead of marking them sent', () => {
  const src = readFileSync(new URL('../functions/api/admin/newsletters.js', import.meta.url), 'utf8');
  assert.match(src, /if \(r\.capped\) \{/);
  assert.match(src, /delivery_offset:\s*nextOffset/);
  assert.match(src, /continuationSchedule\(n\.schedule, r\.next_offset\)/);
  assert.match(src, /status:\s*'scheduled'/);
});
