import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-crm-pipeline.sql', import.meta.url), 'utf8');

test('adds the five pipeline columns', () => {
  for (const col of ['pipeline_stage', 'deal_value', 'expected_close', 'stage_changed_at', 'lost_reason']) {
    assert.match(sql, new RegExp(`add column if not exists ${col}\\b`));
  }
});

test('constrains stage to the six-stage allow-list', () => {
  assert.match(sql, /pipeline_stage in \('new','qualified','sample_audit','proposal','won','lost'\)/);
});

test('indexes the pipeline lookup', () => {
  assert.match(sql, /create index if not exists quotes_pipeline_stage_idx/);
});
