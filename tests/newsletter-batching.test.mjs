import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DELIVERY_CONCURRENCY,
  DELIVERY_MAX_ATTEMPTS,
  DELIVERY_MAX_BATCH_SIZE,
  deliveryIdentity,
  deliverySummary,
  deliveryTransition,
  normalizeDeliveryEmails,
  runDeliveryWorker,
} from '../functions/_lib/newsletter-delivery.js';

function emails(count) {
  return Array.from({ length: count }, (_, index) => `person-${index}@example.test`);
}

test('materialization normalizes and deduplicates empty, overlapping, and large audiences', () => {
  assert.deepEqual(normalizeDeliveryEmails([]), []);
  assert.deepEqual(
    normalizeDeliveryEmails([' A@Example.test ', 'a@example.test', 'b@example.test', 'invalid']),
    ['a@example.test', 'b@example.test'],
  );

  for (const count of [1, 5, 6, 500, 501]) {
    assert.equal(normalizeDeliveryEmails(emails(count)).length, count);
  }
});

test('delivery identity uses source plus normalized email and preserves provider idempotency key', () => {
  assert.deepEqual(deliveryIdentity('newsletter', 'campaign-1', ' Person@Example.test '), {
    sourceType: 'newsletter',
    sourceId: 'campaign-1',
    email: 'person@example.test',
    key: 'newsletter:campaign-1:person@example.test',
    providerIdempotencyKey: 'newsletter:campaign-1:person@example.test',
  });
  assert.equal(
    deliveryIdentity('blog_post', 'post-1', 'Person@Example.test').providerIdempotencyKey,
    'blog-newsletter:post-1:person@example.test',
  );
});

test('delivery transitions cover sent, suppression, provider retry, network retry, and dead letter', () => {
  const now = Date.parse('2026-07-19T12:00:00.000Z');
  assert.deepEqual(deliveryTransition({ ok: true, resendId: 're_1' }, 1, now), {
    state: 'sent',
    provider_message_id: 're_1',
    sent_at: '2026-07-19T12:00:00.000Z',
  });
  assert.deepEqual(deliveryTransition({ suppressed: true }, 1, now), {
    state: 'suppressed',
    last_error: 'all_recipients_suppressed',
  });

  for (const result of [
    { status: 429, error: 'resend_429' },
    { status: 500, error: 'resend_500' },
    { network: true, error: 'network_down' },
  ]) {
    const retry = deliveryTransition(result, 2, now);
    assert.equal(retry.state, 'retry');
    assert.equal(retry.last_error, result.error);
    assert.ok(Date.parse(retry.available_at) > now);
  }

  assert.deepEqual(
    deliveryTransition({ status: 500, error: 'resend_500' }, DELIVERY_MAX_ATTEMPTS, now),
    { state: 'dead', last_error: 'resend_500' },
  );
  assert.deepEqual(
    deliveryTransition({ status: 400, error: 'resend_400' }, 1, now),
    { state: 'dead', last_error: 'resend_400' },
  );
});

test('ledger summary completes only when every row is terminal', () => {
  assert.deepEqual(deliverySummary([]), {
    total: 0, pending: 0, processing: 0, retry: 0,
    sent: 0, suppressed: 0, dead: 0, terminal: 0, complete: true,
  });
  assert.equal(deliverySummary(['sent', 'suppressed', 'dead']).complete, true);
  assert.equal(deliverySummary(['sent', 'retry']).complete, false);
  assert.equal(deliverySummary(['sent', 'processing']).complete, false);
});

class MemoryDeliveryStore {
  constructor(rows, now) {
    this.rows = rows.map((row, index) => ({
      id: String(index + 1),
      source_type: 'newsletter',
      source_id: 'campaign-1',
      normalized_email: row,
      provider_idempotency_key: `newsletter:campaign-1:${row}`,
      state: 'pending',
      attempts: 0,
      available_at: new Date(now).toISOString(),
      lease_token: null,
      lease_expires_at: null,
    }));
    this.now = now;
  }

  async claim({ workerId, limit, leaseSeconds }) {
    const claimable = this.rows.filter((row) => (
      (row.state === 'pending' || row.state === 'retry')
      && Date.parse(row.available_at) <= this.now
    ) || (
      row.state === 'processing'
      && Date.parse(row.lease_expires_at) <= this.now
    )).slice(0, limit);
    for (const row of claimable) {
      row.state = 'processing';
      row.attempts += 1;
      row.lease_token = workerId;
      row.lease_expires_at = new Date(this.now + leaseSeconds * 1000).toISOString();
    }
    return claimable.map((row) => ({ ...row }));
  }

  async finish(row, transition, workerId) {
    const current = this.rows.find((candidate) => candidate.id === row.id);
    if (current?.state !== 'processing' || current.lease_token !== workerId) return false;
    Object.assign(current, transition, { lease_token: null, lease_expires_at: null });
    return true;
  }

  async reconcile() {
    return deliverySummary(this.rows.map((row) => row.state));
  }
}

test('worker starts at concurrency 5 and remains bounded for 1, 5, 6, 500, and over 500', async () => {
  assert.equal(DELIVERY_CONCURRENCY, 5);

  for (const count of [1, 5, 6, 500, 501]) {
    const now = Date.parse('2026-07-19T12:00:00.000Z');
    const store = new MemoryDeliveryStore(emails(count), now);
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await runDeliveryWorker({
      store,
      limit: count,
      now: () => now,
      send: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { ok: true };
      },
    });
    assert.equal(result.claimed, Math.min(count, DELIVERY_MAX_BATCH_SIZE));
    assert.ok(maxInFlight <= DELIVERY_CONCURRENCY);
    assert.equal(
      store.rows.filter((row) => row.state === 'pending').length,
      Math.max(0, count - DELIVERY_MAX_BATCH_SIZE),
    );
  }
});

test('duplicate workers cannot claim active leases; expired leases reuse the same idempotency key', async () => {
  const now = Date.parse('2026-07-19T12:00:00.000Z');
  const store = new MemoryDeliveryStore(['one@example.test'], now);
  const [claimed] = await store.claim({ workerId: 'crashed', limit: 1, leaseSeconds: 60 });
  const second = await runDeliveryWorker({
    store,
    workerId: 'duplicate-cron',
    now: () => now,
    send: async () => ({ ok: true }),
  });
  assert.equal(second.claimed, 0);

  store.now += 60_000;
  let retriedKey = null;
  const retried = await runDeliveryWorker({
    store,
    workerId: 'retry-worker',
    now: () => store.now,
    send: async (row) => {
      retriedKey = row.provider_idempotency_key;
      return { ok: true };
    },
  });
  assert.equal(retried.claimed, 1);
  assert.equal(retriedKey, claimed.provider_idempotency_key);
  assert.equal(store.rows[0].attempts, 2);
  assert.equal(store.rows[0].state, 'sent');
});

test('partial blog failure stays incomplete until retry becomes terminal', async () => {
  const now = Date.parse('2026-07-19T12:00:00.000Z');
  const store = new MemoryDeliveryStore(['sent@example.test', 'retry@example.test'], now);
  store.rows.forEach((row) => {
    row.source_type = 'blog_post';
    row.source_id = 'post-1';
    row.provider_idempotency_key = `blog-newsletter:post-1:${row.normalized_email}`;
  });

  const first = await runDeliveryWorker({
    store,
    limit: 2,
    now: () => store.now,
    send: async (row) => (
      row.normalized_email.startsWith('retry')
        ? { status: 500, error: 'resend_500' }
        : { ok: true }
    ),
  });
  assert.equal(first.summaries[0].complete, false);
  assert.equal(first.summaries[0].retry, 1);

  store.now = Date.parse(store.rows.find((row) => row.state === 'retry').available_at);
  const second = await runDeliveryWorker({
    store,
    now: () => store.now,
    send: async () => ({ suppressed: true }),
  });
  assert.equal(second.summaries[0].complete, true);
  assert.equal(second.summaries[0].sent, 1);
  assert.equal(second.summaries[0].suppressed, 1);
});

test('schema enforces unique ledger identities and lease-safe bounded claims', () => {
  const schema = readFileSync(new URL('../supabase/schema-newsletters.sql', import.meta.url), 'utf8');
  assert.match(schema, /state in \('pending', 'processing', 'sent', 'suppressed', 'retry', 'dead'\)/);
  assert.match(schema, /unique \(source_type, source_id, normalized_email\)/);
  assert.match(schema, /for update skip locked/i);
  assert.match(schema, /limit least\(greatest\(coalesce\(p_limit, 25\), 1\), 500\)/);
  assert.match(schema, /finish_newsletter_delivery/);
  assert.match(schema, /newsletter_delivery_summary/);
  assert.match(schema, /grant execute on function public\.claim_newsletter_deliveries[\s\S]+to service_role/);
});
