import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet, onRequestPost } from '../functions/api/account/quotes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const QUOTE_ID = '44444444-4444-4444-8444-444444444444';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-08-17T12:00:00.000Z';

function request(method, body) {
  return new Request(`https://masest.test/api/account/quotes${method === 'GET' ? '?limit=25&offset=0' : ''}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

function accountQuoteDb({
  profileCompanyId = COMPANY_ID,
  quoteCompanyId = COMPANY_ID,
  expiresAt = '2026-08-18T12:00:00.000Z',
  offerStatus = 'sent',
  concurrentMutation = false,
} = {}) {
  const state = {
    writes: 0,
    orderReads: 0,
    orFilters: [],
    quoteContains: [],
    quote: {
      id: QUOTE_ID,
      created_at: '2026-08-17T10:00:00.000Z',
      type: 'quote',
      product: 'VertKleen HCR',
      industry: 'Industrial',
      email: 'buyer@example.com',
      source: 'requisition',
      status: 'contacted',
      pipeline_stage: 'proposal',
      offer_revision: 1,
      checkout_mutation_id: null,
      checkout_mutation_kind: null,
      checkout_mutation_order_id: null,
      checkout_mutation_offer_revision: null,
      payload: {
        requisition_id: '66666666-6666-4666-8666-666666666666',
        requester_id: USER_ID,
        company_id: quoteCompanyId,
        offer_order_id: OFFER_ID,
        offer_status: offerStatus,
        offer_expires_at: expiresAt,
      },
    },
    offer: {
      id: OFFER_ID,
      company_id: quoteCompanyId,
      user_id: USER_ID,
      status: 'cart',
      requisition_name: null,
      subtotal: 125,
      total: 125,
      currency: 'usd',
      order_items: [{ sku: 'VK-HCR-5G', product_sku: 'VK-HCR', name: 'HCR 5 gal', qty: 1, unit_price: 125, line_total: 125 }],
    },
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.patch = null;
      this.filters = [];
    }

    select() { return this; }
    update(patch) { this.patch = patch; return this; }
    eq(column, value) { this.filters.push(['eq', column, value]); return this; }
    neq(column, value) { this.filters.push(['neq', column, value]); return this; }
    ilike(column, value) { this.filters.push(['ilike', column, value]); return this; }
    is(column, value) { this.filters.push(['is', column, value]); return this; }
    in(column, value) { this.filters.push(['in', column, value]); return this; }
    contains(column, value) {
      if (this.table === 'quotes') state.quoteContains.push([column, value]);
      this.filters.push(['contains', column, value]);
      return this;
    }
    or(value) { state.orFilters.push(value); this.filters.push(['or', value]); return this; }
    order() { return this; }

    matches(row) {
      return this.filters.every(([kind, column, value]) => {
        if (kind === 'or') {
          if (row.source !== 'requisition') return true;
          return column.includes(`payload->>requester_id.eq.${USER_ID}`)
            && column.includes(`payload->>company_id.eq.${profileCompanyId}`)
            && row.payload?.requester_id === USER_ID
            && row.payload?.company_id === profileCompanyId;
        }
        const actual = column.startsWith('payload->>')
          ? row.payload?.[column.slice('payload->>'.length)]
          : row[column];
        if (kind === 'eq') return actual === value;
        if (kind === 'neq') return actual !== value;
        if (kind === 'ilike') return String(actual || '').toLowerCase() === String(value || '').replace(/\\([%_\\])/g, '$1').toLowerCase();
        if (kind === 'is') return actual === value;
        if (kind === 'in') return value.includes(actual);
        if (kind === 'contains') return Object.entries(value).every(([key, expected]) => row[column]?.[key] === expected);
        return true;
      });
    }

    rows() {
      if (this.table === 'profiles') return [{ company_id: profileCompanyId, id: USER_ID }];
      if (this.table === 'quotes') return this.matches(state.quote) ? [state.quote] : [];
      if (this.table === 'orders') {
        state.orderReads += 1;
        return this.matches(state.offer) ? [state.offer] : [];
      }
      throw new Error(`unexpected table ${this.table}`);
    }

    async maybeSingle() {
      if (this.patch && this.table === 'quotes') {
        if (concurrentMutation || !this.matches(state.quote)) return { data: null, error: null };
        state.writes += 1;
        state.quote = { ...state.quote, ...this.patch };
        return { data: { id: state.quote.id, ...state.quote }, error: null };
      }
      return { data: this.rows()[0] || null, error: null };
    }

    async range(offset, end) {
      const rows = this.rows();
      return { data: rows.slice(offset, end + 1), error: null, count: rows.length };
    }

    then(resolve, reject) {
      return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
    }
  }

  return {
    state,
    db: { from: (table) => new Query(table) },
  };
}

function dependencies(db) {
  return {
    userFromRequest: async () => ({ user: { id: USER_ID, email: 'buyer@example.com' } }),
    adminClient: () => db,
    now: () => new Date(NOW),
  };
}

function dependenciesWithEmail(db, email) {
  return {
    ...dependencies(db),
    userFromRequest: async () => ({ user: { id: USER_ID, email } }),
  };
}

test('email match never authorizes a requisition mutation across the current Company', async () => {
  const { db, state } = accountQuoteDb({ profileCompanyId: OTHER_COMPANY_ID });
  const result = await responseJson(await onRequestPost({
    request: request('POST', { action: 'decline_offer', id: QUOTE_ID }),
    env: {},
  }, dependencies(db)));

  assert.deepEqual(result, { status: 403, body: { error: 'forbidden' } });
  assert.equal(state.writes, 0);
  assert.equal(state.orderReads, 0, 'ownership must be proven before the offer draft is read');
});

test('Buyer decline is CAS-protected, persists an optional reason, and closes CRM state', async () => {
  const { db, state } = accountQuoteDb();
  const result = await responseJson(await onRequestPost({
    request: request('POST', { action: 'decline_offer', id: QUOTE_ID, reason: 'Timing changed' }),
    env: {},
  }, dependencies(db)));

  assert.equal(result.status, 200);
  assert.equal(result.body.declined, true);
  assert.equal(state.quote.payload.offer_status, 'declined');
  assert.equal(state.quote.payload.offer_declined_reason, 'Timing changed');
  assert.equal(state.quote.status, 'closed');
  assert.equal(state.quote.pipeline_stage, 'lost');
});

test('Buyer decline fences and invalidates an accepted Checkout attempt before closing the Quote', async () => {
  const mutationId = '77777777-7777-4777-8777-777777777777';
  const { db, state } = accountQuoteDb({ offerStatus: 'accepted' });
  const prepared = [];
  const result = await responseJson(await onRequestPost({
    request: request('POST', { action: 'decline_offer', id: QUOTE_ID }),
    env: {},
  }, {
    ...dependencies(db),
    prepareQuoteCheckoutMutation: async (input) => {
      assert.equal(state.writes, 0, 'the checkout fence must precede the Quote mutation');
      prepared.push(input);
      state.quote.checkout_mutation_id = mutationId;
      state.quote.checkout_mutation_kind = 'decline';
      state.quote.checkout_mutation_order_id = OFFER_ID;
      state.quote.checkout_mutation_offer_revision = 1;
      return { mutationId };
    },
  }));

  assert.equal(result.status, 200);
  assert.equal(prepared.length, 1);
  assert.deepEqual(prepared[0].identity, {
    quoteId: QUOTE_ID,
    quoteOrderId: OFFER_ID,
    requesterId: USER_ID,
    companyId: COMPANY_ID,
    offerRevision: 1,
    offerStatus: 'accepted',
  });
  assert.equal(prepared[0].kind, 'decline');
  assert.equal(state.quote.payload.offer_status, 'declined');
  assert.equal(state.quote.checkout_mutation_id, null);
  assert.equal(state.quote.checkout_mutation_kind, null);
  assert.equal(state.quote.checkout_mutation_order_id, null);
  assert.equal(state.quote.checkout_mutation_offer_revision, null);
});

test('the exact expiry boundary persists expired before accept or decline actionability', async () => {
  const { db, state } = accountQuoteDb({ expiresAt: NOW });
  const result = await responseJson(await onRequestPost({
    request: request('POST', { action: 'accept_offer', id: QUOTE_ID }),
    env: {},
  }, dependencies(db)));

  assert.deepEqual(result, { status: 409, body: { error: 'offer_unavailable' } });
  assert.equal(state.quote.payload.offer_status, 'expired');
  assert.equal(state.quote.next_step, 'Offer expired; revise or close');
});

test('Buyer GET applies exact requester and current Company ownership before actions', async () => {
  const exact = accountQuoteDb();
  const exactResult = await responseJson(await onRequestGet({ request: request('GET'), env: {} }, dependencies(exact.db)));
  assert.equal(exactResult.status, 200);
  assert.equal(exactResult.body.quotes.length, 1);
  assert.equal(exactResult.body.quotes[0].can_accept, true);
  assert.deepEqual(exact.state.quoteContains, [[
    'payload',
    { requester_id: USER_ID, company_id: COMPANY_ID },
  ]]);

  const switched = accountQuoteDb({ profileCompanyId: OTHER_COMPANY_ID });
  const switchedResult = await responseJson(await onRequestGet({ request: request('GET'), env: {} }, dependencies(switched.db)));
  assert.equal(switchedResult.status, 200);
  assert.deepEqual(switchedResult.body.quotes, []);
});

test('account email changes do not revoke requester and current Company ownership', async () => {
  const getCase = accountQuoteDb();
  const getResult = await responseJson(await onRequestGet(
    { request: request('GET'), env: {} },
    dependenciesWithEmail(getCase.db, 'new-address@example.com'),
  ));
  assert.equal(getResult.status, 200);
  assert.equal(getResult.body.quotes.length, 1);
  assert.equal(getResult.body.quotes[0].can_accept, true);

  const postCase = accountQuoteDb();
  const postResult = await responseJson(await onRequestPost({
    request: request('POST', { action: 'accept_offer', id: QUOTE_ID }),
    env: {},
  }, dependenciesWithEmail(postCase.db, 'new-address@example.com')));
  assert.equal(postResult.status, 200);
  assert.equal(postCase.state.quote.payload.offer_status, 'accepted');
});

test('concurrent offer mutation loses the Buyer accept CAS with a refreshable conflict', async () => {
  const { db, state } = accountQuoteDb({ concurrentMutation: true });
  const result = await responseJson(await onRequestPost({
    request: request('POST', { action: 'accept_offer', id: QUOTE_ID }),
    env: {},
  }, dependencies(db)));

  assert.deepEqual(result, { status: 409, body: { error: 'quote_changed' } });
  assert.equal(state.quote.payload.offer_status, 'sent');
});
