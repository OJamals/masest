import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/quotes.js', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../functions/_lib/quote-leads.js', import.meta.url), 'utf8');

test('imports the pure pipeline lib at the right depth', () => {
  assert.match(lifecycle, /from '\.\/crm-pipeline\.js'/);
});

test('GET list selects the new pipeline columns', () => {
  assert.match(src, /pipeline_stage,deal_value,expected_close,stage_changed_at,lost_reason/);
});

test('serves a pipeline forecast view', () => {
  assert.match(src, /=== 'pipeline'/);
  assert.match(src, /pipelineSummary\(/);
});

test('serves a pipeline report view', () => {
  assert.match(src, /=== 'report'/);
  assert.match(src, /pipelineReport\(/);
  assert.match(src, /expected_close,lost_reason/);
});

test('POST validates stage + accepts deal fields', () => {
  assert.match(lifecycle, /stagePatch\(/);
  assert.match(lifecycle, /if \(stage\.error\) return \{ ok: false, error: stage\.error \}/);
  assert.match(lifecycle, /changes\.deal_value/);
  assert.match(lifecycle, /invalid_deal_value/);
  assert.match(lifecycle, /changes\.expected_close/);
});

test('convert marks the quote won', () => {
  assert.match(lifecycle, /pipeline_stage: 'won'/);
});

test('supports bulk row updates by id array', () => {
  assert.match(src, /Array\.isArray\(body\.ids\)/);
  assert.match(src, /leadLifecycle\.bulkUpdate\(/);
  assert.match(lifecycle, /\.in\('id', ids\)/);
  assert.match(lifecycle, /updated:/);
});

test('stays staff + write guarded', () => {
  assert.match(src, /requireStaff/);
  assert.match(src, /staffCanWrite\(role\)/);
});

test('fires a Klaviyo metric event on stage change', () => {
  assert.match(src, /klaviyoTrack\(/);
  assert.match(src, /'Deal Stage Changed'/);
});
