import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuoteLeadLifecycle } from '../functions/_lib/quote-leads.js';

function lifecycleStore(overrides = {}) {
  const calls = [];
  return {
    calls,
    async currentStage(id) {
      calls.push(['currentStage', id]);
      return 'qualified';
    },
    async updateQuote(id, patch) {
      calls.push(['updateQuote', id, patch]);
      return { id, email: 'buyer@example.com', product: 'HCR', company: 'Acme', type: 'quote', ...patch };
    },
    async quotesForStage(ids) {
      calls.push(['quotesForStage', ids]);
      return [
        { id: 'q1', email: 'one@example.com', pipeline_stage: 'new', deal_value: 10 },
        { id: 'q2', email: 'two@example.com', pipeline_stage: 'proposal', deal_value: 20 },
      ];
    },
    async updateQuotes(ids, patch) {
      calls.push(['updateQuotes', ids, patch]);
    },
    async quoteForFollowUp(id) {
      calls.push(['quoteForFollowUp', id]);
      return {
        id,
        name: 'Buyer',
        email: 'buyer@example.com',
        company: 'Acme',
        status: 'new',
        next_step: 'Review pricing',
        due_at: null,
        notes: 'Existing note',
      };
    },
    async updateFollowUp(id, patch) {
      calls.push(['updateFollowUp', id, patch]);
      return { id, ...patch };
    },
    async dueQuotes(nowIso, limit) {
      calls.push(['dueQuotes', nowIso, limit]);
      return [
        { id: 'q1', email: 'buyer@example.com', company: 'Acme', status: 'new', next_step: 'Call buyer', notes: '' },
        { id: 'q2', email: '', name: 'No Email', status: 'contacted', next_step: '', notes: 'Keep' },
      ];
    },
    async updateDueQuote(id, patch) {
      calls.push(['updateDueQuote', id, patch]);
      return null;
    },
    async workspaceQuote(id) {
      calls.push(['workspaceQuote', id]);
      return {
        id,
        source: 'requisition',
        payload: {
          requisition_id: '11111111-1111-4111-8111-111111111111',
          requester_id: '22222222-2222-4222-8222-222222222222',
          company_id: '33333333-3333-4333-8333-333333333333',
          offer_order_id: '44444444-4444-4444-8444-444444444444',
          offer_status: 'sent',
        },
      };
    },
    async workspaceData(input) {
      calls.push(['workspaceData', input]);
      return {
        requisition: {
          id: input.requisitionId,
          requisition_name: 'Plant 2 refill',
          currency: 'usd',
          subtotal: 50,
          total: 50,
          order_items: [{ sku: 'A' }],
        },
        offer: {
          id: input.offerOrderId,
          currency: 'usd',
          subtotal: 45,
          total: 45,
          order_items: [{ sku: 'A', unit_price: 45 }],
        },
        messages: [{ id: 'm1' }],
        documents: [{ id: 'd1' }],
      };
    },
    async offerQuote(id) {
      calls.push(['offerQuote', id]);
      return {
        id,
        source: 'requisition',
        email: 'buyer@example.com',
        company: 'Acme',
        product: 'HCR',
        status: 'new',
        payload: {
          requisition_id: '11111111-1111-4111-8111-111111111111',
          requester_id: '22222222-2222-4222-8222-222222222222',
          company_id: '33333333-3333-4333-8333-333333333333',
        },
      };
    },
    async requisition(input) {
      calls.push(['requisition', input]);
      return {
        id: input.requisitionId,
        currency: 'usd',
        order_items: [{ sku: 'A', product_sku: 'hcr', name: 'HCR' }],
      };
    },
    async createOrder(row) {
      calls.push(['createOrder', row]);
      return { id: '55555555-5555-4555-8555-555555555555' };
    },
    async insertOrderItems(orderId, items) {
      calls.push(['insertOrderItems', orderId, items]);
    },
    async updateOffer(input) {
      calls.push(['updateOffer', input]);
      return { id: input.quote.id, ...input.patch };
    },
    async deleteOrder(id, scope) {
      calls.push(['deleteOrder', id, scope]);
    },
    async notify(input) {
      calls.push(['notify', input]);
    },
    async company(companyId) {
      calls.push(['company', companyId]);
      return { id: companyId, status: 'active' };
    },
    async markConverted(id, patch) {
      calls.push(['markConverted', id, patch]);
    },
    async convertedQuote(id) {
      calls.push(['convertedQuote', id]);
      return {
        email: 'buyer@example.com',
        deal_value: 50,
        product: 'HCR',
        company: 'Acme',
        type: 'quote',
      };
    },
    async orderRecipients(companyId) {
      calls.push(['orderRecipients', companyId]);
      return ['orders@acme.co'];
    },
    ...overrides,
  };
}

test('single lead update applies lifecycle policy and emits stage effect once', async () => {
  const store = lifecycleStore();
  const effects = [];
  const lifecycle = createQuoteLeadLifecycle({
    store,
    now: () => new Date('2026-07-29T12:00:00Z'),
    stageChanged: async (quote, stage, source) => effects.push({ quote, stage, source }),
  });

  const result = await lifecycle.update({
    id: 'q1',
    actor: 'owner@masest.co',
    changes: {
      status: 'contacted',
      priority: 'urgent',
      assigned_to: ' rep@masest.co ',
      pipeline_stage: 'proposal',
      deal_value: '125.50',
      expected_close: '2026-08-15T10:30:00Z',
      contact_id: '42',
      due_at: '2026-08-01T09:00:00Z',
    },
  });

  assert.equal(result.ok, true);
  const update = store.calls.find(([name]) => name === 'updateQuote');
  assert.deepEqual(update[2], {
    status: 'contacted',
    handled_at: '2026-07-29T12:00:00.000Z',
    handled_by: 'owner@masest.co',
    priority: 'urgent',
    assigned_to: 'rep@masest.co',
    assigned_at: '2026-07-29T12:00:00.000Z',
    pipeline_stage: 'proposal',
    stage_changed_at: '2026-07-29T12:00:00.000Z',
    deal_value: 125.5,
    expected_close: '2026-08-15',
    contact_id: 42,
    due_at: '2026-08-01T09:00:00.000Z',
  });
  assert.equal(effects.length, 1);
  assert.equal(effects[0].stage, 'proposal');
  assert.equal(effects[0].source, 'pipeline');
});

test('unchanged stage is a no-op and never restamps or emits an event', async () => {
  const store = lifecycleStore({ currentStage: async () => 'qualified' });
  const effects = [];
  const lifecycle = createQuoteLeadLifecycle({
    store,
    stageChanged: async (...args) => effects.push(args),
  });

  assert.deepEqual(await lifecycle.update({
    id: 'q1',
    actor: 'owner@masest.co',
    changes: { pipeline_stage: 'qualified' },
  }), { ok: false, error: 'nothing_to_update' });
  assert.equal(store.calls.some(([name]) => name === 'updateQuote'), false);
  assert.deepEqual(effects, []);
});

test('bulk lead update moves only quotes not already in target stage', async () => {
  const store = lifecycleStore();
  const effects = [];
  const lifecycle = createQuoteLeadLifecycle({
    store,
    now: () => new Date('2026-07-29T12:00:00Z'),
    stageChanged: async (quote, stage, source) => effects.push({ quote, stage, source }),
  });

  const result = await lifecycle.bulkUpdate({
    ids: ['q1', 'q2'],
    actor: 'owner@masest.co',
    changes: { priority: 'high', pipeline_stage: 'proposal' },
  });

  assert.deepEqual(result, { ok: true, updated: 2, stage_moved: 1 });
  assert.deepEqual(store.calls.filter(([name]) => name === 'updateQuotes'), [
    ['updateQuotes', ['q1', 'q2'], { priority: 'high' }],
    ['updateQuotes', ['q1'], {
      pipeline_stage: 'proposal',
      stage_changed_at: '2026-07-29T12:00:00.000Z',
    }],
  ]);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].source, 'pipeline_bulk');
});

test('lead lifecycle rejects invalid transition input before writes', async () => {
  const store = lifecycleStore();
  const lifecycle = createQuoteLeadLifecycle({ store });

  assert.deepEqual(await lifecycle.update({
    id: 'q1',
    actor: 'owner@masest.co',
    changes: { status: 'bogus' },
  }), { ok: false, error: 'invalid_status' });
  assert.deepEqual(await lifecycle.bulkUpdate({
    ids: ['q1'],
    actor: 'owner@masest.co',
    changes: { priority: 'bogus' },
  }), { ok: false, error: 'invalid_priority' });
  assert.deepEqual(store.calls, []);
});

test('follow-up owns customer message, thread handoff, and lifecycle update', async () => {
  const store = lifecycleStore();
  const effects = [];
  const lifecycle = createQuoteLeadLifecycle({
    store,
    now: () => new Date('2026-07-29T12:00:00Z'),
    sendFollowUp: async (input) => effects.push(['sendFollowUp', input]),
    handoff: async (input) => {
      effects.push(['handoff', input]);
      return { posted: true, message_id: 'm1' };
    },
  });

  const result = await lifecycle.followUp({
    id: 'q1',
    actor: 'owner@masest.co',
    companyId: 'c1',
    subject: 'Pricing update',
    nextStep: 'Approve proposal',
    dueAt: '2026-08-01T09:00:00Z',
  });

  assert.equal(result.ok, true);
  assert.equal(effects[0][0], 'sendFollowUp');
  assert.equal(effects[1][0], 'handoff');
  const update = store.calls.find(([name]) => name === 'updateFollowUp');
  assert.deepEqual(update[2], {
    status: 'contacted',
    handled_at: '2026-07-29T12:00:00.000Z',
    handled_by: 'owner@masest.co',
    next_step: 'Follow-up sent',
    due_at: '2026-08-01T09:00:00.000Z',
    notes: 'Existing note\nFollow-up sent by owner@masest.co: Approve proposal\nBuyer message thread updated (m1)',
  });
});

test('due sweep owns reminder policy and rescheduling outcomes', async () => {
  const store = lifecycleStore();
  const notices = [];
  const lifecycle = createQuoteLeadLifecycle({
    store,
    now: () => new Date('2026-07-29T12:00:00Z'),
    sendDueNotice: async (input) => {
      notices.push(input);
      return input.hasBuyerEmail;
    },
  });

  const result = await lifecycle.sweepDue({
    actor: 'automation',
    batch: 10,
  });

  assert.deepEqual(result, {
    ok: true,
    processed: 2,
    buyer_reminders: 1,
    staff_alerts: 1,
    results: [
      { id: 'q1', ok: true, emailed: true, error: undefined },
      { id: 'q2', ok: true, emailed: false, error: undefined },
    ],
  });
  assert.equal(notices[0].hasBuyerEmail, true);
  assert.equal(notices[1].hasBuyerEmail, false);
  const updates = store.calls.filter(([name]) => name === 'updateDueQuote');
  assert.equal(updates[0][2].status, 'contacted');
  assert.equal(updates[0][2].due_at, '2026-07-31T12:00:00.000Z');
  assert.equal(updates[1][2].status, 'contacted');
  assert.equal(updates[1][2].due_at, '2026-07-30T12:00:00.000Z');
  assert.match(updates[0][2].notes, /buyer reminder sent/);
  assert.match(updates[1][2].notes, /staff alert attempted/);
});

test('workspace exposes requisition and active offer through lifecycle interface', async () => {
  const store = lifecycleStore();
  const lifecycle = createQuoteLeadLifecycle({ store });

  const result = await lifecycle.workspace({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.workspace.offer_order_id, '44444444-4444-4444-8444-444444444444');
  assert.equal(result.body.workspace.total, 45);
  assert.deepEqual(result.body.workspace.messages, [{ id: 'm1' }]);
});

test('send offer links canonical Order, advances proposal, and emits effects', async () => {
  const store = lifecycleStore();
  const effects = [];
  const lifecycle = createQuoteLeadLifecycle({
    store,
    now: () => new Date('2026-07-29T12:00:00Z'),
    handoff: async (input) => {
      effects.push(['handoff', input]);
      return { posted: true };
    },
    offerReady: async (input) => effects.push(['offerReady', input]),
    audit: async (input) => effects.push(['audit', input]),
  });

  const result = await lifecycle.sendOffer({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    items: [{ sku: 'A', qty: 2, unit_price: 25 }],
    actor: 'owner@masest.co',
    user: { email: 'owner@masest.co' },
    appUrl: 'https://masest.co',
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.order_id, '55555555-5555-4555-8555-555555555555');
  const create = store.calls.find(([name]) => name === 'createOrder');
  assert.equal(create[1].status, 'cart');
  assert.equal(create[1].total, 50);
  const offer = store.calls.find(([name]) => name === 'updateOffer');
  assert.equal(offer[1].patch.pipeline_stage, 'proposal');
  assert.equal(offer[1].patch.payload.offer_status, 'sent');
  assert.deepEqual(effects.map(([name]) => name), ['handoff', 'offerReady', 'audit']);
});

test('convert links a canonical NET Order and closes lead as won', async () => {
  const store = lifecycleStore();
  const effects = [];
  const lifecycle = createQuoteLeadLifecycle({
    store,
    now: () => new Date('2026-07-29T12:00:00Z'),
    converted: async (input) => effects.push(['converted', input]),
    stageChanged: async (quote, stage, source) => effects.push(['stageChanged', { quote, stage, source }]),
    audit: async (input) => effects.push(['audit', input]),
  });

  const result = await lifecycle.convert({
    id: 'q1',
    companyId: '33333333-3333-4333-8333-333333333333',
    items: [{ sku: 'A', qty: 2, unit_price: 25 }],
    actor: 'owner@masest.co',
    user: { email: 'owner@masest.co' },
    appUrl: 'https://masest.co',
  });

  assert.deepEqual(result, {
    status: 200,
    body: { ok: true, order_id: '55555555-5555-4555-8555-555555555555' },
  });
  const create = store.calls.find(([name]) => name === 'createOrder');
  assert.equal(create[1].status, 'net_open');
  assert.equal(create[1].payment_method, 'net');
  const converted = store.calls.find(([name]) => name === 'markConverted');
  assert.equal(converted[2].pipeline_stage, 'won');
  assert.equal(converted[2].next_step, 'Converted to order');
  assert.deepEqual(effects.map(([name]) => name), ['converted', 'stageChanged', 'audit']);
});
