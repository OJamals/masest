import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/quotes.js', import.meta.url), 'utf8');

test('imports the pure pipeline lib at the right depth', () => {
  assert.match(src, /from '\.\.\/\.\.\/_lib\/crm-pipeline\.js'/);
  assert.doesNotMatch(src, /from '\.\.\/_lib\/crm-pipeline/);
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
  assert.match(src, /stagePatch\(/);
  assert.match(src, /if \(res\.error\) return json\(400/); // stage validation propagated as 400
  assert.match(src, /body\.deal_value/);
  assert.match(src, /invalid_deal_value/);
  assert.match(src, /body\.expected_close/);
});

test('convert marks the quote won', () => {
  assert.match(src, /pipeline_stage: 'won'/);
});

test('supports bulk row updates by id array', () => {
  assert.match(src, /Array\.isArray\(body\.ids\)/);
  assert.match(src, /\.in\('id', ids\)/);
  assert.match(src, /updated:/);
});

test('stays staff + write guarded', () => {
  assert.match(src, /requireStaff/);
  assert.match(src, /staffCanWrite\(role\)/);
});

test('fires a Klaviyo metric event on stage change', () => {
  assert.match(src, /klaviyoTrack\(/);
  assert.match(src, /'Deal Stage Changed'/);
});
