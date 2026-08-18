import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  finishQuoteCheckoutAttemptFromSession,
  openQuoteCheckoutSession,
  preflightQuoteCheckoutAttemptFromSession,
  prepareQuoteCheckoutMutation,
  QuoteCheckoutAttemptError,
} from '../functions/_lib/quote-checkout-attempt.js';

const QUOTE_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = '44444444-4444-4444-8444-444444444444';
const ATTEMPT_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
];
const identity = {
  quoteId: QUOTE_ID,
  quoteOrderId: ORDER_ID,
  requesterId: USER_ID,
  companyId: COMPANY_ID,
  offerRevision: 1,
  orderSnapshot: {
    id: ORDER_ID,
    company_id: COMPANY_ID,
    user_id: USER_ID,
    status: 'cart',
    requisition_name: null,
    subtotal: 25,
    total: 25,
    currency: 'usd',
    items: [{ sku: 'VK-1', product_sku: 'VK', name: 'VertKleen', qty: 1, unit_price: 25, line_total: 25 }],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class StatefulAttemptStore {
  constructor() {
    this.attempts = [];
    this.failAttachBeforeCommitOnce = false;
    this.failAttachAfterCommitOnce = false;
    this.finished = [];
  }

  async claim({ candidateId, identity: owner, fingerprint, requestParams }) {
    assert.deepEqual(owner, identity);
    const active = this.attempts.find((attempt) => ['creating', 'open'].includes(attempt.status));
    if (active) {
      if (active.request_fingerprint === fingerprint && active.status === 'creating') {
        return { action: 'recover', attempt_id: active.id, status: active.status, request_params: clone(active.request_params) };
      }
      if (active.request_fingerprint === fingerprint
        && active.status === 'open'
        && active.stripe_session_expires_at > Date.now()) {
        return {
          action: 'reuse',
          attempt_id: active.id,
          status: active.status,
          stripe_session_id: active.stripe_session_id,
          stripe_session_url: active.stripe_session_url,
        };
      }
      return {
        action: 'reconcile',
        attempt_id: active.id,
        status: active.status,
        request_params: active.status === 'creating' ? clone(active.request_params) : null,
        stripe_session_id: active.stripe_session_id || null,
      };
    }
    const latest = this.attempts.at(-1);
    if (latest?.status === 'completed') {
      return { action: 'blocked', attempt_id: latest.id, status: latest.status };
    }
    const attempt = {
      id: candidateId,
      status: 'creating',
      request_fingerprint: fingerprint,
      request_params: clone(requestParams),
    };
    this.attempts.push(attempt);
    return {
      action: 'created',
      attempt_id: attempt.id,
      status: attempt.status,
      request_params: clone(attempt.request_params),
    };
  }

  async attach({ attemptId, session }) {
    const attempt = this.attempts.find(({ id }) => id === attemptId);
    if (!attempt || attempt.status !== 'creating') throw new Error('attempt_not_attachable');
    if (this.failAttachBeforeCommitOnce) {
      this.failAttachBeforeCommitOnce = false;
      throw new Error('database_response_lost');
    }
    attempt.status = 'open';
    attempt.stripe_session_id = session.id;
    attempt.stripe_session_url = session.url;
    attempt.stripe_session_expires_at = Number(session.expires_at) * 1000;
    attempt.request_params = null;
    if (this.failAttachAfterCommitOnce) {
      this.failAttachAfterCommitOnce = false;
      throw new Error('database_response_lost_after_commit');
    }
    return {
      status: attempt.status,
      stripe_session_id: attempt.stripe_session_id,
      stripe_session_url: attempt.stripe_session_url,
    };
  }

  async finish(input) {
    const attempt = this.attempts.find(({ id }) => id === input.attemptId);
    if (!attempt) throw new Error('attempt_not_found');
    if (attempt.stripe_session_id && attempt.stripe_session_id !== input.sessionId) {
      throw new Error('session_identity_conflict');
    }
    attempt.status = input.terminalStatus;
    attempt.stripe_session_id ||= input.sessionId || null;
    attempt.request_params = null;
    this.finished.push({ ...input });
    return { attempt_id: attempt.id, status: attempt.status };
  }
}

class FakeStripe {
  constructor() {
    this.byKey = new Map();
    this.createCalls = [];
    this.retrieveCalls = [];
    this.expireCalls = [];
    this.checkout = { sessions: {
      create: this.create.bind(this),
      retrieve: this.retrieve.bind(this),
      expire: this.expire.bind(this),
    } };
  }

  async create(params, options) {
    this.createCalls.push({ params: clone(params), options: clone(options) });
    if (this.byKey.has(options.idempotencyKey)) return this.byKey.get(options.idempotencyKey);
    const number = this.byKey.size + 1;
    const session = {
      id: `cs_quote_${number}`,
      status: 'open',
      expires_at: params.expires_at || 4102444800,
      url: `https://checkout.stripe.test/session-${number}`,
    };
    this.byKey.set(options.idempotencyKey, session);
    return session;
  }

  async retrieve(id) {
    this.retrieveCalls.push(id);
    return [...this.byKey.values()].find((session) => session.id === id);
  }

  async expire(id) {
    this.expireCalls.push(id);
    const session = await this.retrieve(id);
    session.status = 'expired';
    return session;
  }
}

function params(po = '') {
  return {
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 2500 } }],
    metadata: {
      quote_id: QUOTE_ID,
      quote_order_id: ORDER_ID,
      purchase_order_number: po,
      quote_checkout_attempt_id: '',
    },
  };
}

function idFactory() {
  let index = 0;
  return () => ATTEMPT_IDS[index++];
}

test('identical Quote retry reuses one active Session and one attempt idempotency key', async () => {
  const store = new StatefulAttemptStore();
  const stripe = new FakeStripe();
  const nextId = idFactory();
  const first = await openQuoteCheckoutSession({
    stripe, store, identity, requestParams: params(), fingerprintValue: params(), attemptIdFactory: nextId,
  });
  const retry = await openQuoteCheckoutSession({
    stripe, store, identity, requestParams: params(), fingerprintValue: params(), attemptIdFactory: nextId,
  });

  assert.equal(first.url, retry.url);
  assert.equal(first.attemptId, retry.attemptId);
  assert.equal(stripe.createCalls.length, 1);
  assert.equal(store.attempts.filter(({ status }) => status === 'open').length, 1);
  assert.equal(stripe.createCalls[0].options.idempotencyKey, `quote-checkout-attempt:${first.attemptId}`);
  assert.equal(stripe.createCalls[0].params.metadata.quote_offer_revision, '1');
});

test('provider success followed by an uncommitted local attach failure replays the same Stripe Session', async () => {
  const store = new StatefulAttemptStore();
  store.failAttachBeforeCommitOnce = true;
  const stripe = new FakeStripe();
  const nextId = idFactory();

  await assert.rejects(
    openQuoteCheckoutSession({
      stripe, store, identity, requestParams: params(), fingerprintValue: params(), attemptIdFactory: nextId,
    }),
    (error) => error instanceof QuoteCheckoutAttemptError
      && error.code === 'quote_checkout_attempt_unavailable',
  );
  const recovered = await openQuoteCheckoutSession({
    stripe, store, identity, requestParams: params(), fingerprintValue: params(), attemptIdFactory: nextId,
  });

  assert.equal(stripe.createCalls.length, 2, 'the provider call is replayed after local response loss');
  assert.equal(stripe.byKey.size, 1, 'Stripe idempotency resolves both calls to one Session');
  assert.equal(stripe.createCalls[0].options.idempotencyKey, stripe.createCalls[1].options.idempotencyKey);
  assert.equal(recovered.url, 'https://checkout.stripe.test/session-1');
});

test('provider success followed by a committed response loss reuses the attached Stripe Session', async () => {
  const store = new StatefulAttemptStore();
  store.failAttachAfterCommitOnce = true;
  const stripe = new FakeStripe();
  const nextId = idFactory();

  await assert.rejects(
    openQuoteCheckoutSession({
      stripe, store, identity, requestParams: params(), fingerprintValue: params(), attemptIdFactory: nextId,
    }),
    (error) => error instanceof QuoteCheckoutAttemptError
      && error.code === 'quote_checkout_attempt_unavailable',
  );
  const recovered = await openQuoteCheckoutSession({
    stripe, store, identity, requestParams: params(), fingerprintValue: params(), attemptIdFactory: nextId,
  });

  assert.equal(stripe.createCalls.length, 1, 'the committed attachment is reused without another provider call');
  assert.equal(store.attempts.length, 1);
  assert.equal(store.attempts[0].status, 'open');
  assert.equal(recovered.url, 'https://checkout.stripe.test/session-1');
});

test('changed Checkout inputs expire the exact prior Session before a new attempt is claimed', async () => {
  const store = new StatefulAttemptStore();
  const stripe = new FakeStripe();
  const nextId = idFactory();
  const first = await openQuoteCheckoutSession({
    stripe, store, identity, requestParams: params('PO-1'), fingerprintValue: params('PO-1'), attemptIdFactory: nextId,
  });
  const changed = await openQuoteCheckoutSession({
    stripe, store, identity, requestParams: params('PO-2'), fingerprintValue: params('PO-2'), attemptIdFactory: nextId,
  });

  assert.notEqual(first.attemptId, changed.attemptId);
  assert.deepEqual(stripe.expireCalls, ['cs_quote_1']);
  assert.equal(stripe.byKey.get(`quote-checkout-attempt:${first.attemptId}`).status, 'expired');
  assert.equal(store.attempts.filter(({ status }) => status === 'open').length, 1);
  assert.equal(store.attempts.filter(({ status }) => status === 'expired').length, 1);
});

test('a revised offer reconciles the prior attempt with its stored draft identity', async () => {
  const priorOrderId = '99999999-9999-4999-8999-999999999999';
  const finished = [];
  let claims = 0;
  const store = {
    async claim({ candidateId, fingerprint, requestParams }) {
      claims += 1;
      if (claims === 1) {
        return {
          action: 'reconcile',
          attempt_id: ATTEMPT_IDS[0],
          status: 'open',
          quote_id: QUOTE_ID,
          quote_order_id: priorOrderId,
          requester_id: USER_ID,
          company_id: COMPANY_ID,
          offer_revision: 1,
          stripe_session_id: 'cs_prior_revision',
        };
      }
      return {
        action: 'created',
        attempt_id: candidateId,
        status: 'creating',
        quote_id: QUOTE_ID,
        quote_order_id: ORDER_ID,
        requester_id: USER_ID,
        company_id: COMPANY_ID,
        offer_revision: 2,
        request_fingerprint: fingerprint,
        request_params: clone(requestParams),
      };
    },
    async finish(input) {
      finished.push(input);
      return { attempt_id: input.attemptId, status: input.terminalStatus };
    },
    async attach({ attemptId, session }) {
      return { attempt_id: attemptId, status: 'open', stripe_session_url: session.url };
    },
  };
  const stripe = new FakeStripe();
  stripe.byKey.set('prior', {
    id: 'cs_prior_revision',
    status: 'expired',
    expires_at: 4102444800,
    url: 'https://checkout.stripe.test/prior',
  });
  const currentIdentity = { ...identity, offerRevision: 2 };

  await openQuoteCheckoutSession({
    stripe,
    store,
    identity: currentIdentity,
    requestParams: params('revision-2'),
    fingerprintValue: params('revision-2'),
    attemptIdFactory: idFactory(),
  });

  assert.deepEqual(finished[0].identity, {
    quoteId: QUOTE_ID,
    quoteOrderId: priorOrderId,
    requesterId: USER_ID,
    companyId: COMPANY_ID,
    offerRevision: 1,
  });
});

test('a completed prior Session blocks changed-input rotation until webhook processing finishes', async () => {
  const store = new StatefulAttemptStore();
  const stripe = new FakeStripe();
  const nextId = idFactory();
  const first = await openQuoteCheckoutSession({
    stripe, store, identity, requestParams: params('PO-1'), fingerprintValue: params('PO-1'), attemptIdFactory: nextId,
  });
  stripe.byKey.get(`quote-checkout-attempt:${first.attemptId}`).status = 'complete';

  await assert.rejects(
    openQuoteCheckoutSession({
      stripe, store, identity, requestParams: params('PO-2'), fingerprintValue: params('PO-2'), attemptIdFactory: nextId,
    }),
    (error) => error instanceof QuoteCheckoutAttemptError
      && error.code === 'quote_checkout_processing',
  );
  assert.equal(stripe.byKey.size, 1);
  assert.equal(store.attempts[0].status, 'provider_completed');
});

test('an aged ambiguous provider attempt fails closed without creating another Session', async () => {
  const stripe = new FakeStripe();
  await assert.rejects(
    openQuoteCheckoutSession({
      stripe,
      store: {
        async claim() {
          return { action: 'blocked', attempt_id: ATTEMPT_IDS[0], status: 'creating' };
        },
      },
      identity,
      requestParams: params(),
      fingerprintValue: params(),
      attemptIdFactory: idFactory(),
    }),
    (error) => error instanceof QuoteCheckoutAttemptError
      && error.code === 'quote_checkout_attempt_unavailable',
  );
  assert.equal(stripe.createCalls.length, 0);
});

test('decline preparation expires the exact active Session while retaining the Quote mutation fence', async () => {
  const stripe = new FakeStripe();
  stripe.byKey.set('existing', {
    id: 'cs_decline_exact',
    status: 'open',
    expires_at: 4102444800,
    url: 'https://checkout.stripe.test/decline',
  });
  const finished = [];
  const mutationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const result = await prepareQuoteCheckoutMutation({
    stripe,
    identity: { ...identity, offerStatus: 'accepted' },
    kind: 'decline',
    mutationIdFactory: () => mutationId,
    store: {
      async beginMutation() {
        return {
          action: 'reconcile',
          mutation_id: mutationId,
          attempt_id: ATTEMPT_IDS[0],
          status: 'open',
          quote_id: QUOTE_ID,
          quote_order_id: ORDER_ID,
          requester_id: USER_ID,
          company_id: COMPANY_ID,
          offer_revision: 1,
          stripe_session_id: 'cs_decline_exact',
        };
      },
      async finish(input) { finished.push(input); return { status: input.terminalStatus }; },
    },
  });

  assert.deepEqual(result, { mutationId });
  assert.deepEqual(stripe.expireCalls, ['cs_decline_exact']);
  assert.equal(finished[0].terminalStatus, 'expired');
  assert.deepEqual(finished[0].identity, {
    quoteId: QUOTE_ID,
    quoteOrderId: ORDER_ID,
    requesterId: USER_ID,
    companyId: COMPANY_ID,
    offerRevision: 1,
  });
});

test('webhook preflight claims the exact attempt, Session, event, and offer revision', async () => {
  const calls = [];
  const result = await preflightQuoteCheckoutAttemptFromSession(null, {
    id: 'cs_quote_preflight',
    metadata: {
      quote_checkout_attempt_id: ATTEMPT_IDS[0],
      quote_id: QUOTE_ID,
      quote_order_id: ORDER_ID,
      quote_offer_revision: '1',
    },
  }, 'evt_quote_preflight', {
    store: {
      async preflight(input) { calls.push(input); return { action: 'process' }; },
    },
  });

  assert.deepEqual(result, { action: 'process' });
  assert.deepEqual(calls, [{
    attemptId: ATTEMPT_IDS[0],
    identity: { quoteId: QUOTE_ID, quoteOrderId: ORDER_ID, offerRevision: 1 },
    sessionId: 'cs_quote_preflight',
    eventId: 'evt_quote_preflight',
  }]);
});

test('a paid pre-cutover Quote Session is adopted before webhook Order mutation', async () => {
  const adoptedAttemptId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const calls = [];
  const result = await preflightQuoteCheckoutAttemptFromSession(null, {
    id: 'cs_legacy_quote',
    metadata: {
      quote_id: QUOTE_ID,
      quote_order_id: ORDER_ID,
    },
  }, 'evt_legacy_quote', {
    store: {
      async preflightLegacy(input) {
        calls.push(input);
        return {
          action: 'process',
          attempt_id: adoptedAttemptId,
          offer_revision: 1,
        };
      },
    },
  });

  assert.deepEqual(result, {
    action: 'process',
    legacy: true,
    attemptId: adoptedAttemptId,
    offerRevision: 1,
  });
  assert.deepEqual(calls, [{
    quoteId: QUOTE_ID,
    quoteOrderId: ORDER_ID,
    sessionId: 'cs_legacy_quote',
    eventId: 'evt_legacy_quote',
  }]);
});

test('webhook terminalization is bound to the exact attempt, Quote, draft, and Stripe Session', async () => {
  const calls = [];
  const result = await finishQuoteCheckoutAttemptFromSession(null, {
    id: 'cs_quote_exact',
    status: 'complete',
    metadata: {
      quote_checkout_attempt_id: ATTEMPT_IDS[0],
      quote_id: QUOTE_ID,
      quote_order_id: ORDER_ID,
      quote_offer_revision: '1',
    },
  }, {
    terminalStatus: 'completed',
    reason: 'payment_completed',
    store: { async finish(input) { calls.push(input); return { status: 'completed' }; } },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [{
    attemptId: ATTEMPT_IDS[0],
    identity: { quoteId: QUOTE_ID, quoteOrderId: ORDER_ID, offerRevision: 1 },
    sessionId: 'cs_quote_exact',
    terminalStatus: 'completed',
    providerStatus: 'complete',
    reason: 'payment_completed',
  }]);
});

test('an adopted legacy ACH Session terminalizes by its durable Session binding', async () => {
  const calls = [];
  const result = await finishQuoteCheckoutAttemptFromSession(null, {
    id: 'cs_legacy_ach',
    status: 'complete',
    metadata: {
      quote_id: QUOTE_ID,
      quote_order_id: ORDER_ID,
    },
  }, {
    terminalStatus: 'failed',
    reason: 'async_payment_failed',
    store: {
      async finishLegacy(input) {
        calls.push(input);
        return { status: 'failed' };
      },
    },
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(calls, [{
    identity: { quoteId: QUOTE_ID, quoteOrderId: ORDER_ID },
    sessionId: 'cs_legacy_ach',
    terminalStatus: 'failed',
    providerStatus: 'complete',
    reason: 'async_payment_failed',
  }]);
});

test('Quote Checkout attempt migration locks ownership, one active row, and exact Session terminalization', () => {
  const schema = readFileSync(new URL('../supabase/schema-quote-lifecycle.sql', import.meta.url), 'utf8');
  assert.match(schema, /quote_checkout_attempt_cutover[\s\S]*ready boolean not null default false/i);
  assert.match(schema, /quote_checkout_cutover_pending/);
  assert.match(schema, /quote_checkout_attempts_active_quote_idx[\s\S]*status in \('creating', 'open', 'provider_completed', 'processing'\)/);
  assert.match(schema, /from public\.quotes[\s\S]*where id = p_quote_id[\s\S]*for update/);
  assert.match(schema, /payload ->> 'requester_id' is distinct from p_requester_id::text/);
  assert.match(schema, /payload ->> 'company_id' is distinct from p_company_id::text/);
  assert.match(schema, /payload ->> 'offer_expires_at'/);
  assert.match(schema, /v_attempt\.created_at <= now\(\) - interval '23 hours'[\s\S]*v_action := 'blocked'/);
  assert.match(schema, /v_attempt\.stripe_session_id is distinct from p_stripe_session_id/);
  assert.match(schema, /create or replace function public\.claim_quote_checkout_webhook/);
  assert.match(schema, /create or replace function public\.finish_legacy_quote_checkout_attempt/);
  assert.match(schema, /prevent_active_quote_checkout_order_mutation/);
  assert.match(schema, /offer_revision/);
  assert.match(schema, /offer_status', ''\) not in \('accepted', 'expired'\)/i,
    'a paid exact Session must remain recoverable when the local expiry sweep wins the webhook race');
  assert.match(schema, /revoke all on table public\.quote_checkout_attempts from public, anon, authenticated/);
});
