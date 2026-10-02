import test from 'node:test';
import assert from 'node:assert/strict';
import { salesActions } from '../js/admin/connected-sales-contract.js';
import * as contract from '../js/admin/connected-sales-contract.js';
const id = () => crypto.randomUUID();
const context = { workspace_id: id(), staff_id: id() };
const store = () => { const data = new Map(); return { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }; };
const task = (body) => ({ id: id(), revision: 1, title: body.title, owner_staff_id: context.staff_id, owner_name: null, body: '', status: 'open', priority: 'normal', due_at: null, completed_at: null });

test('canonical assignee rejection clears pending so another target can be chosen', async () => {
  const actions = salesActions(async () => { throw Object.assign(new Error('unavailable'), { status: 403, data: { error: { code: 'assignee_unavailable' } } }); }, context, store());
  await assert.rejects(actions.execute('sales_tasks', {}, { action_id: id(), title: 'Synthetic', owner_staff_id: id() }));
  assert.equal(actions.pending, null);
});

test('uncertain command survives reload and reuses exact body and action ID', async () => {
  const storage = store(); const calls = []; const body = { action_id: id(), title: 'Synthetic', owner_staff_id: context.staff_id };
  const api = async (_, options) => { calls.push(options.body); if (calls.length === 1) throw new Error('lost'); return task(body); };
  const first = salesActions(api, context, storage);
  await assert.rejects(first.execute('sales_tasks', {}, body));
  const next = salesActions(api, context, storage);
  assert.deepEqual(next.pending.body, body); await next.retry();
  assert.deepEqual(calls[0], calls[1]); assert.equal(next.pending, null);
});

test('malformed or wrong-entity receipts retain pending command', async () => {
  const body = { action_id: id(), expected_revision: 1, title: 'Edited', reason: 'Synthetic' };
  for (const result of [{ id: id() }, { ...task(body), revision: 2 }]) {
    const actions = salesActions(async () => result, context, store());
    await assert.rejects(actions.execute('sales_task', { record_id: id() }, body));
    assert.deepEqual(actions.pending.body, body);
  }
});

test('storage failure prevents submission and another actor cannot see pending data', async () => {
  let calls = 0; const api = async () => { calls++; throw new Error('lost'); };
  const body = { action_id: id(), title: 'Synthetic' };
  const storage = store(); const actions = salesActions(api, context, storage);
  await assert.rejects(actions.execute('sales_tasks', {}, body));
  assert.equal(salesActions(api, { ...context, staff_id: id() }, storage).pending, null);
  const blocked = salesActions(api, context, { ...store(), setItem: () => { throw new Error('denied'); } });
  await assert.rejects(blocked.execute('sales_tasks', {}, body)); assert.equal(calls, 1);
});

test('auth and throttling failures preserve uncertain original action across reload', async () => {
  for (const status of [401, 403, 429]) {
    const storage = store(); let count = 0;
    const body = { action_id: id(), title: 'Synthetic' };
    const api = async () => { if (++count === 1) throw new Error('lost receipt'); throw Object.assign(new Error('rejected'), { status, data: { error: { code: 'access_rejected' } } }); };
    const actions = salesActions(api, context, storage);
    await assert.rejects(actions.execute('sales_tasks', {}, body));
    await assert.rejects(actions.retry());
    assert.deepEqual(salesActions(api, context, storage).pending.body, body);
  }
});

test('pipeline receipt must match requested ordered stages and required kinds', async () => {
  const stages = [{ name: 'Open', kind: 'open' }, { name: 'Won', kind: 'won' }, { name: 'Lost', kind: 'lost' }];
  for (const changed of [[{ name: 'Wrong', kind: 'open' }, ...stages.slice(1)], [...stages].reverse(), stages.map((s) => ({ ...s, kind: 'open' }))]) {
    const pipelineId = id(); const body = { action_id: id(), name: 'Synthetic', stages };
    const receipt = { id: pipelineId, name: body.name, stages: changed.map((s, position) => ({ ...s, id: id(), pipeline_id: pipelineId, position })) };
    const actions = salesActions(async () => receipt, context, store());
    await assert.rejects(actions.execute('sales_pipelines', {}, body));
    assert.deepEqual(actions.pending.body, body);
  }
});

test('editor and paginated board reject records from other pipelines or stages', () => {
  const pipelineId = id(); const stageId = id();
  const pipeline = { id: pipelineId, name: 'Synthetic', stages: ['open', 'won', 'lost'].map((kind, position) => ({ id: id(), name: kind, kind, position, pipeline_id: pipelineId })) };
  assert.equal(contract.salesBoardPipeline({ pipeline }, pipelineId), pipeline);
  assert.throws(() => contract.salesBoardPipeline({ pipeline }, id()));
  const deal = { ...task({ title: 'Deal' }), pipeline_id: pipelineId, stage_id: stageId, amount: '1.00', currency: 'USD' };
  const page = { items: [deal], next_cursor: null };
  assert.equal(contract.salesDealPage(page, pipelineId, stageId), page);
  assert.throws(() => contract.salesDealPage(page, id(), stageId));
  assert.throws(() => contract.salesDealPage(page, pipelineId, id()));
});
