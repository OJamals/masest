import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PIPELINE_STAGES, STAGE_PROBABILITY, LOST_REASONS,
  validStage, isTerminal, stagePatch, pipelineSummary,
} from '../functions/_lib/crm-pipeline.js';

const NOW = new Date('2026-06-25T12:00:00.000Z');

test('six stages in funnel order', () => {
  assert.deepEqual(PIPELINE_STAGES, ['new', 'qualified', 'sample_audit', 'proposal', 'won', 'lost']);
});

test('validStage + isTerminal', () => {
  assert.equal(validStage('proposal'), true);
  assert.equal(validStage('bogus'), false);
  assert.equal(isTerminal('won'), true);
  assert.equal(isTerminal('lost'), true);
  assert.equal(isTerminal('new'), false);
});

test('stagePatch rejects invalid stage', () => {
  assert.deepEqual(stagePatch({ stage: 'bogus' }, NOW), { error: 'invalid_stage' });
});

test('stagePatch non-terminal sets stage + stamp only', () => {
  const { patch } = stagePatch({ stage: 'qualified' }, NOW);
  assert.equal(patch.pipeline_stage, 'qualified');
  assert.equal(patch.stage_changed_at, NOW.toISOString());
  assert.equal(patch.status, undefined);
});

test('stagePatch won closes the quote', () => {
  const { patch } = stagePatch({ stage: 'won', actor: 'a@b.co' }, NOW);
  assert.equal(patch.status, 'closed');
  assert.equal(patch.handled_by, 'a@b.co');
});

test('stagePatch lost captures reason (defaults to other) and closes', () => {
  assert.equal(stagePatch({ stage: 'lost', lost_reason: 'price' }, NOW).patch.lost_reason, 'price');
  assert.equal(stagePatch({ stage: 'lost' }, NOW).patch.lost_reason, 'other');
  assert.equal(stagePatch({ stage: 'lost' }, NOW).patch.status, 'closed');
});

test('pipelineSummary weights value by stage probability, excludes null values', () => {
  const s = pipelineSummary([
    { pipeline_stage: 'qualified', deal_value: 1000 },
    { pipeline_stage: 'proposal', deal_value: 2000 },
    { pipeline_stage: 'proposal', deal_value: null },
    { pipeline_stage: 'lost', deal_value: 5000 },
  ]);
  assert.equal(s.weighted, 1700);            // 1000*0.3 + 2000*0.7
  assert.equal(s.open_value, 3000);          // qualified+proposal, not lost
  const proposal = s.stages.find((x) => x.stage === 'proposal');
  assert.equal(proposal.count, 2);
  assert.equal(proposal.value, 2000);
});

test('LOST_REASONS + STAGE_PROBABILITY present', () => {
  assert.ok(LOST_REASONS.includes('competitor'));
  assert.equal(STAGE_PROBABILITY.won, 1);
});
