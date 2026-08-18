import assert from 'node:assert/strict';
import test from 'node:test';

import { createQuoteLeadLifecycle } from '../functions/_lib/quote-leads.js';
import { quotePayloadWithOffer } from '../functions/_lib/quote-convert.js';
import {
  finalizeQuoteOrder,
  markQuotePaymentPending,
  reopenQuoteAfterPaymentFailure,
} from '../functions/_lib/quote-order.js';
import {
  quoteBuyerActions,
  quoteDeliveryState,
  quoteIsOpenRequisition,
  quoteLifecycle,
} from '../functions/_lib/quote-lifecycle.js';
import { applyQuoteFilters, quoteFilters } from '../functions/api/admin/quotes.js';
import { openQuoteCheckoutSession } from '../functions/_lib/quote-checkout-attempt.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const REQUISITION_ID = '33333333-3333-4333-8333-333333333333';
const QUOTE_ID = '44444444-4444-4444-8444-444444444444';
const DRAFT_ID = '55555555-5555-4555-8555-555555555555';
const FINAL_ONE = '66666666-6666-4666-8666-666666666666';
const FINAL_TWO = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-08-17T12:00:00.000Z';

function clone(value) {
  return structuredClone(value);
}

function checkoutAttemptHarness() {
  const attempts = [];
  const sessions = new Map();
  let sequence = 0;
  const store = {
    async claim({ candidateId, fingerprint, requestParams }) {
      const active = attempts.find((attempt) => ['creating', 'open'].includes(attempt.status));
      if (active) {
        if (active.request_fingerprint === fingerprint && active.status === 'open') {
          return { action: 'reuse', attempt_id: active.id, status: active.status, stripe_session_url: active.url };
        }
        return { action: 'reconcile', attempt_id: active.id, status: active.status, stripe_session_id: active.session_id };
      }
      if (attempts.at(-1)?.status === 'completed') {
        return { action: 'blocked', attempt_id: attempts.at(-1).id, status: 'completed' };
      }
      const attempt = { id: candidateId, status: 'creating', request_fingerprint: fingerprint, request_params: clone(requestParams) };
      attempts.push(attempt);
      return { action: 'created', attempt_id: attempt.id, status: attempt.status, request_params: clone(attempt.request_params) };
    },
    async attach({ attemptId, session }) {
      const attempt = attempts.find(({ id }) => id === attemptId);
      Object.assign(attempt, { status: 'open', session_id: session.id, url: session.url, request_params: null });
      return { status: 'open', stripe_session_id: session.id, stripe_session_url: session.url };
    },
    async finish({ attemptId, sessionId, terminalStatus }) {
      const attempt = attempts.find(({ id }) => id === attemptId);
      assert.ok(attempt);
      if (attempt.session_id) assert.equal(attempt.session_id, sessionId);
      attempt.session_id ||= sessionId;
      attempt.status = terminalStatus;
      return { status: terminalStatus };
    },
  };
  const stripe = { checkout: { sessions: {
    async create(_params, { idempotencyKey }) {
      if (sessions.has(idempotencyKey)) return sessions.get(idempotencyKey);
      const number = sessions.size + 1;
      const session = {
        id: `cs_workflow_${number}`,
        status: 'open',
        expires_at: 4102444800,
        url: `https://checkout.stripe.test/workflow-${number}`,
      };
      sessions.set(idempotencyKey, session);
      return session;
    },
    async retrieve(id) { return [...sessions.values()].find((session) => session.id === id); },
    async expire(id) {
      const session = [...sessions.values()].find((item) => item.id === id);
      session.status = 'expired';
      return session;
    },
  } } };
  return {
    attempts,
    sessions,
    store,
    stripe,
    nextId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12, '0')}`,
  };
}

function workflow({ now = NOW, prepareCheckoutChange } = {}) {
  const state = {
    now,
    nextDraftId: DRAFT_ID,
    commitConflict: false,
    freshOpenExists: false,
    effects: [],
    quote: {
      id: QUOTE_ID,
      source: 'requisition',
      email: 'buyer@example.com',
      company: 'Buyer Co',
      product: 'VertKleen HCR',
      status: 'new',
      pipeline_stage: 'new',
      offer_revision: 0,
      payload: {
        requisition_id: REQUISITION_ID,
        requester_id: USER_ID,
        company_id: COMPANY_ID,
      },
    },
    orders: new Map([[
      REQUISITION_ID,
      {
        id: REQUISITION_ID,
        company_id: COMPANY_ID,
        user_id: USER_ID,
        customer_email: 'buyer@example.com',
        status: 'cart',
        requisition_name: 'Plant refill',
        subtotal: 200,
        total: 200,
        currency: 'usd',
        order_items: [{ sku: 'VK-HCR-5G', product_sku: 'VK-HCR', name: 'HCR 5 gal', qty: 2, unit_price: 100, line_total: 200 }],
      },
    ]]),
  };

  const store = {
    async offerQuote(id) { return id === state.quote.id ? clone(state.quote) : null; },
    async requisition({ requisitionId, requesterId, companyId }) {
      const order = state.orders.get(requisitionId);
      return order && order.user_id === requesterId && order.company_id === companyId
        && order.status === 'cart' && order.requisition_name
        ? clone(order)
        : null;
    },
    async createOrder(row) {
      const id = state.nextDraftId;
      state.orders.set(id, { id, ...clone(row), requisition_name: null, order_items: [] });
      return { id };
    },
    async insertOrderItems(orderId, items) {
      state.orders.get(orderId).order_items = clone(items);
    },
    async commitOffer(input) {
      if (state.freshOpenExists) {
        throw Object.assign(new Error('quotes_open_requisition_unique_idx'), { code: '23505' });
      }
      const expected = input.quote;
      if (state.commitConflict
        || state.quote.status !== expected.status
        || state.quote.payload?.offer_order_id !== expected.payload?.offer_order_id
        || state.quote.payload?.offer_status !== expected.payload?.offer_status) return null;
      state.effects = input.effects.map((effect) => ({ ...clone(effect), status: 'pending' }));
      state.quote = {
        ...state.quote,
        payload: { ...clone(input.payload), offer_delivery_event_id: input.eventId },
        status: 'contacted',
        pipeline_stage: 'proposal',
        deal_value: input.dealValue,
        next_step: 'Buyer review and checkout',
        offer_revision: Number(state.quote.offer_revision || 0) + 1,
      };
      return clone(state.quote);
    },
    async deleteOrder(id) { state.orders.delete(id); },
    async expirableOffers() { return [clone(state.quote)]; },
    async expireOffer({ quote, patch }) {
      if (state.quote.payload?.offer_status !== quote.payload?.offer_status
        || state.quote.payload?.offer_order_id !== quote.payload?.offer_order_id) return null;
      state.quote = { ...state.quote, ...clone(patch) };
      return clone(state.quote);
    },
  };

  const lifecycle = createQuoteLeadLifecycle({
    store,
    now: () => new Date(state.now),
    prepareCheckoutChange: prepareCheckoutChange || (async () => ({
      mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })),
  });

  class DbQuery {
    constructor(table, action = 'select', patch = null) {
      this.table = table;
      this.action = action;
      this.patch = patch;
      this.filters = [];
    }
    select() { return this; }
    update(patch) { this.action = 'update'; this.patch = patch; return this; }
    delete() { this.action = 'delete'; return this; }
    eq(column, value) { this.filters.push(['eq', column, value]); return this; }
    is(column, value) { this.filters.push(['is', column, value]); return this; }
    contains(column, value) { this.filters.push(['contains', column, value]); return this; }

    matches(row) {
      return this.filters.every(([kind, column, value]) => {
        const actual = column.startsWith('payload->>')
          ? (row.payload?.[column.slice('payload->>'.length)] ?? null)
          : row[column];
        if (kind === 'eq' || kind === 'is') return actual === value;
        return kind !== 'contains'
          || Object.entries(value).every(([key, expected]) => row[column]?.[key] === expected);
      });
    }

    row() {
      if (this.table === 'quotes') return state.quote;
      if (this.table === 'orders') {
        const id = this.filters.find(([, column]) => column === 'id')?.[2];
        return state.orders.get(id) || null;
      }
      throw new Error(`unexpected table ${this.table}`);
    }

    async maybeSingle() {
      const row = this.row();
      if (!row || !this.matches(row)) return { data: null, error: null };
      if (this.action === 'update') {
        if (state.forceQuoteCasConflict) return { data: null, error: null };
        state.quote = { ...state.quote, ...clone(this.patch) };
        return { data: clone(state.quote), error: null };
      }
      return { data: clone(row), error: null };
    }

    then(resolve, reject) {
      try {
        const row = this.row();
        if (this.action === 'delete' && row && this.matches(row)) state.orders.delete(row.id);
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    }
  }

  const db = {
    from(table) {
      const query = new DbQuery(table);
      query.update = (patch) => { query.action = 'update'; query.patch = patch; return query; };
      query.delete = () => { query.action = 'delete'; return query; };
      return query;
    },
  };

  function buyerAccept() {
    const offer = state.orders.get(state.quote.payload?.offer_order_id);
    const actions = quoteBuyerActions(state.quote, {
      userId: USER_ID,
      companyId: COMPANY_ID,
      hasOffer: Boolean(offer?.order_items?.length),
      now: Date.parse(state.now),
    });
    if (!actions.can_accept) return false;
    state.quote.payload = quotePayloadWithOffer(state.quote.payload, {
      orderId: offer.id,
      status: 'accepted',
      at: state.now,
    });
    return true;
  }

  return { state, store, lifecycle, db, buyerAccept };
}

test('Saved requisition → staff offer → Buyer accept → payment retry → webhook Order finalization', async () => {
  const flow = workflow();
  const sent = await flow.lifecycle.sendOffer({
    id: QUOTE_ID,
    items: [{ sku: 'VK-HCR-5G', name: 'tampered client name', qty: 2, unit_price: 85 }],
    expiresAt: '2026-08-18T12:00:00.000Z',
    actor: 'staff@masest.test',
  });
  assert.equal(sent.status, 202);
  assert.equal(sent.body.delivery_state, 'queued');
  assert.equal(flow.state.effects.length, 3);
  assert.equal(quoteDeliveryState(flow.state.effects), 'queued');
  assert.equal(flow.state.orders.get(DRAFT_ID).order_items[0].name, 'HCR 5 gal', 'requisition identity owns line names');
  assert.equal(flow.buyerAccept(), true);
  assert.equal(quoteLifecycle(flow.state.quote, Date.parse(flow.state.now)).stage, 'accepted');

  const checkout = checkoutAttemptHarness();
  const checkoutIdentity = {
    quoteId: QUOTE_ID,
    quoteOrderId: DRAFT_ID,
    requesterId: USER_ID,
    companyId: COMPANY_ID,
    offerRevision: flow.state.quote.offer_revision,
  };
  const checkoutParams = {
    mode: 'payment',
    metadata: { quote_id: QUOTE_ID, quote_order_id: DRAFT_ID },
  };
  const firstAttempt = await openQuoteCheckoutSession({
    stripe: checkout.stripe,
    store: checkout.store,
    identity: checkoutIdentity,
    requestParams: checkoutParams,
    fingerprintValue: checkoutParams,
    attemptIdFactory: checkout.nextId,
  });
  assert.equal(checkout.attempts.filter(({ status }) => status === 'open').length, 1);

  flow.state.orders.set(FINAL_ONE, { id: FINAL_ONE, company_id: COMPANY_ID, status: 'pending_payment' });
  assert.deepEqual(await markQuotePaymentPending(flow.db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ONE,
    at: '2026-08-17T12:10:00.000Z',
  }), { ok: true });
  assert.equal(flow.state.quote.payload.offer_status, 'payment_pending');
  await checkout.store.finish({
    attemptId: firstAttempt.attemptId,
    sessionId: 'cs_workflow_1',
    terminalStatus: 'completed',
  });

  flow.state.orders.get(FINAL_ONE).status = 'cancelled';
  assert.deepEqual(await reopenQuoteAfterPaymentFailure(flow.db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ONE,
    at: '2026-08-17T12:20:00.000Z',
  }), { ok: true });
  assert.equal(flow.state.quote.payload.offer_status, 'accepted');
  assert.equal(flow.state.quote.payload.final_order_id, undefined);
  await checkout.store.finish({
    attemptId: firstAttempt.attemptId,
    sessionId: 'cs_workflow_1',
    terminalStatus: 'failed',
  });

  const retryAttempt = await openQuoteCheckoutSession({
    stripe: checkout.stripe,
    store: checkout.store,
    identity: checkoutIdentity,
    requestParams: checkoutParams,
    fingerprintValue: checkoutParams,
    attemptIdFactory: checkout.nextId,
  });
  assert.notEqual(retryAttempt.attemptId, firstAttempt.attemptId);
  assert.equal(checkout.attempts.filter(({ status }) => status === 'open').length, 1);

  flow.state.orders.set(FINAL_TWO, { id: FINAL_TWO, company_id: COMPANY_ID, status: 'paid' });
  assert.deepEqual(await markQuotePaymentPending(flow.db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_TWO,
    at: '2026-08-17T12:25:00.000Z',
  }), { ok: true });
  assert.deepEqual(await finalizeQuoteOrder(flow.db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_TWO,
    at: '2026-08-17T12:30:00.000Z',
  }), { ok: true });
  await checkout.store.finish({
    attemptId: retryAttempt.attemptId,
    sessionId: 'cs_workflow_2',
    terminalStatus: 'completed',
  });
  assert.equal(flow.state.quote.payload.offer_status, 'ordered');
  assert.equal(flow.state.quote.payload.final_order_id, FINAL_TWO);
  assert.equal(flow.state.quote.status, 'closed');
  assert.equal(flow.state.quote.pipeline_stage, 'won');
  assert.equal(flow.state.orders.has(DRAFT_ID), false);
  assert.equal(flow.state.orders.get(FINAL_TWO).company_id, COMPANY_ID, 'the final Order is Company-visible');
  assert.deepEqual(checkout.attempts.map(({ status }) => status), ['failed', 'completed']);
});

test('decline releases open identity; staff revision is explicit reactivation and a fresh-request race wins', async () => {
  const flow = workflow();
  await flow.lifecycle.sendOffer({
    id: QUOTE_ID,
    items: [{ sku: 'VK-HCR-5G', qty: 2, unit_price: 85 }],
    expiresAt: '2026-08-18T12:00:00.000Z',
  });
  flow.state.quote.payload = quotePayloadWithOffer(flow.state.quote.payload, {
    orderId: DRAFT_ID,
    status: 'declined',
    at: '2026-08-17T12:05:00.000Z',
  });
  flow.state.quote.status = 'closed';
  flow.state.quote.pipeline_stage = 'lost';
  assert.equal(quoteIsOpenRequisition(flow.state.quote), false);

  flow.state.nextDraftId = '88888888-8888-4888-8888-888888888888';
  const revised = await flow.lifecycle.sendOffer({
    id: QUOTE_ID,
    items: [{ sku: 'VK-HCR-5G', qty: 2, unit_price: 80 }],
    expiresAt: '2026-08-19T12:00:00.000Z',
  });
  assert.equal(revised.status, 202);
  assert.equal(flow.state.quote.payload.offer_status, 'revised');
  assert.equal(flow.state.quote.status, 'contacted');
  assert.equal(flow.state.quote.pipeline_stage, 'proposal');

  flow.state.quote.payload.offer_status = 'declined';
  flow.state.quote.status = 'closed';
  flow.state.quote.pipeline_stage = 'lost';
  flow.state.freshOpenExists = true;
  flow.state.nextDraftId = '99999999-9999-4999-8999-999999999999';
  const conflict = await flow.lifecycle.sendOffer({
    id: QUOTE_ID,
    items: [{ sku: 'VK-HCR-5G', qty: 2, unit_price: 75 }],
    expiresAt: '2026-08-20T12:00:00.000Z',
  });
  assert.deepEqual(conflict, { status: 409, body: { error: 'open_quote_exists' } });
  assert.equal(flow.state.orders.has(flow.state.nextDraftId), false, 'losing draft is cleaned up');
});

test('staff revision fences the prior offer revision before atomically replacing its draft', async () => {
  const prepared = [];
  const mutationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const flow = workflow({
    prepareCheckoutChange: async (input) => {
      prepared.push(clone(input));
      return { mutationId };
    },
  });
  await flow.lifecycle.sendOffer({
    id: QUOTE_ID,
    items: [{ sku: 'VK-HCR-5G', qty: 2, unit_price: 85 }],
    expiresAt: '2026-08-18T12:00:00.000Z',
  });
  flow.state.quote.offer_revision = 1;
  flow.state.quote.payload = quotePayloadWithOffer(flow.state.quote.payload, {
    orderId: DRAFT_ID,
    status: 'declined',
    at: '2026-08-17T12:05:00.000Z',
  });
  flow.state.quote.status = 'closed';
  flow.state.quote.pipeline_stage = 'lost';
  flow.state.nextDraftId = '88888888-8888-4888-8888-888888888888';

  const revised = await flow.lifecycle.sendOffer({
    id: QUOTE_ID,
    items: [{ sku: 'VK-HCR-5G', qty: 2, unit_price: 80 }],
    expiresAt: '2026-08-19T12:00:00.000Z',
  });

  assert.equal(revised.status, 202);
  assert.equal(prepared.length, 1);
  assert.deepEqual(prepared[0], {
    kind: 'revise',
    identity: {
      quoteId: QUOTE_ID,
      quoteOrderId: DRAFT_ID,
      requesterId: USER_ID,
      companyId: COMPANY_ID,
      offerRevision: 1,
      offerStatus: 'declined',
    },
  });
  assert.equal(flow.state.quote.payload.offer_status, 'revised');
  assert.equal(flow.state.orders.has(DRAFT_ID), false);
});

test('exact expiry, delivery failure, concurrent CAS, and malformed state fail closed', async () => {
  const flow = workflow();
  await flow.lifecycle.sendOffer({
    id: QUOTE_ID,
    items: [{ sku: 'VK-HCR-5G', qty: 2, unit_price: 85 }],
    expiresAt: '2026-08-17T13:00:00.000Z',
  });
  flow.state.effects.forEach((effect) => { effect.status = 'dead'; });
  assert.equal(quoteDeliveryState(flow.state.effects), 'dead');
  flow.state.effects[0].status = 'completed';
  assert.equal(quoteDeliveryState(flow.state.effects), 'degraded');

  flow.state.now = '2026-08-17T13:00:00.000Z';
  assert.equal(quoteBuyerActions(flow.state.quote, {
    userId: USER_ID,
    companyId: COMPANY_ID,
    hasOffer: true,
    now: Date.parse(flow.state.now),
  }).can_accept, false);
  assert.deepEqual(await flow.lifecycle.expireDue(), { ok: true, expired_offers: 1 });
  assert.equal(flow.state.quote.payload.offer_status, 'expired');
  assert.equal(quoteIsOpenRequisition(flow.state.quote), false);

  const malformed = clone(flow.state.quote);
  malformed.payload.offer_status = 'accepted';
  delete malformed.payload.offer_expires_at;
  assert.equal(quoteBuyerActions(malformed, {
    userId: USER_ID,
    companyId: COMPANY_ID,
    hasOffer: true,
    now: Date.parse(flow.state.now),
  }).can_checkout, false);

  flow.state.quote.payload = quotePayloadWithOffer(flow.state.quote.payload, {
    orderId: DRAFT_ID,
    status: 'ordered',
    at: flow.state.now,
  });
  delete flow.state.quote.payload.final_order_id;
  assert.deepEqual(await finalizeQuoteOrder(flow.db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_TWO,
    at: flow.state.now,
  }), { error: 'quote_final_order_mismatch' });
});

class PagedFilterAdapter {
  constructor(rows) { this.rows = rows; }
  filter(predicate) { this.rows = this.rows.filter(predicate); return this; }
  eq(column, value) { return this.filter((row) => row[column] === value); }
  ilike(column, pattern) {
    const needle = pattern.slice(1, -1).toLowerCase();
    return this.filter((row) => String(row[column] || '').toLowerCase().includes(needle));
  }
  not(column, operator, values) {
    const blocked = values.slice(1, -1).split(',');
    return this.filter((row) => operator !== 'in' || !blocked.includes(row[column]));
  }
  lte(column, value) { return this.filter((row) => row[column] && row[column] <= value); }
  gt(column, value) { return this.filter((row) => row[column] && row[column] > value); }
  is(column, value) { return this.filter((row) => row[column] === value); }
  or(expression) {
    const needle = expression.match(/\.ilike\.%(.*?)%(?:,|$)/)?.[1]?.toLowerCase() || '';
    const columns = expression.split(',').map((entry) => entry.split('.')[0]);
    return this.filter((row) => columns.some((column) => String(row[column] || '').toLowerCase().includes(needle)));
  }
  range(offset, end) { return this.rows.slice(offset, end + 1); }
}

test('server filtering finds a matching requisition beyond the unfiltered first page', () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    id: `q-${index}`,
    status: 'new',
    priority: 'normal',
    assigned_to: '',
    company: `Company ${index}`,
  }));
  rows[115] = {
    id: 'target',
    status: 'contacted',
    priority: 'urgent',
    assigned_to: 'Ada',
    company: 'Target Plant',
  };
  const filters = quoteFilters(new URLSearchParams({
    status: 'contacted', priority: 'urgent', owner: 'Ada', search: 'Target',
  }), new Date(NOW));
  const page = applyQuoteFilters(new PagedFilterAdapter(rows), filters).range(0, 99);
  assert.deepEqual(page.map(({ id }) => id), ['target']);
});
