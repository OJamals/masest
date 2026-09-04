import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARKETING_DELIVERY_SOURCE_TYPES,
  enqueueMarketingConsentSync,
  enqueueMarketingDelivery,
  enqueueMarketingSweep,
  normalizeMarketingDeliveryJob,
} from '../functions/_lib/marketing-delivery-queue.js';
import {
  consumeMarketingDeliveryBatch,
  runMarketingConsentSync,
  scheduleMarketingDeliveryWork,
} from '../workers/marketing-email/src/core.js';
import { runMarketingSchedule } from '../workers/marketing-email/src/index.js';

test('marketing queue jobs are versioned, bounded, and contain no recipient data', () => {
  assert.deepEqual(MARKETING_DELIVERY_SOURCE_TYPES, [
    'newsletter', 'blog_post', 'nurture', 'offer', 'review', 'test',
  ]);
  assert.deepEqual(normalizeMarketingDeliveryJob({
    version: 1,
    kind: 'marketing_delivery.drain',
    sourceType: 'newsletter',
    sourceId: 'campaign-1',
  }), {
    version: 1,
    kind: 'marketing_delivery.drain',
    sourceType: 'newsletter',
    sourceId: 'campaign-1',
  });
  assert.throws(() => normalizeMarketingDeliveryJob({
    version: 1, kind: 'marketing_delivery.drain', sourceType: 'order',
  }), /invalid_marketing_delivery_source_type/);
  assert.throws(() => normalizeMarketingDeliveryJob({
    version: 1, kind: 'marketing_delivery.drain', sourceType: 'offer', email: 'buyer@example.com',
  }), /invalid_marketing_delivery_job_fields/);
  assert.deepEqual(normalizeMarketingDeliveryJob({
    version: 1, kind: 'marketing_consent.sync',
  }), { version: 1, kind: 'marketing_consent.sync' });
  assert.throws(() => normalizeMarketingDeliveryJob({
    version: 1, kind: 'marketing_consent.sync', eventId: 'contains-pii-indirection',
  }), /invalid_marketing_delivery_job_fields/);
  assert.deepEqual(normalizeMarketingDeliveryJob({
    version: 1, kind: 'marketing_delivery.sweep',
  }), { version: 1, kind: 'marketing_delivery.sweep' });
  assert.throws(() => normalizeMarketingDeliveryJob({
    version: 1, kind: 'marketing_delivery.sweep', sourceType: 'offer',
  }), /invalid_marketing_delivery_job_fields/);
});

test('Pages producer enqueues only a durable-ledger wake signal and fails closed without binding', async () => {
  const sent = [];
  const result = await enqueueMarketingDelivery({
    MARKETING_EMAIL_QUEUE: {
      async send(body, options) { sent.push({ body, options }); },
    },
  }, { sourceType: 'offer', sourceId: 'offer-42' });
  assert.deepEqual(result, { ok: true, queued: true });
  assert.deepEqual(sent, [{
    body: {
      version: 1,
      kind: 'marketing_delivery.drain',
      sourceType: 'offer',
      sourceId: 'offer-42',
    },
    options: { contentType: 'json' },
  }]);
  assert.doesNotMatch(JSON.stringify(sent), /@|subject|html/i);

  assert.deepEqual(await enqueueMarketingDelivery({}, { sourceType: 'newsletter' }), {
    ok: false,
    queued: false,
    retryable: false,
    error: 'marketing_queue_not_configured',
  });
});

test('Pages producer emits PII-free consent-sync wake signal', async () => {
  const sent = [];
  const result = await enqueueMarketingConsentSync({
    MARKETING_EMAIL_QUEUE: { async send(body) { sent.push(body); } },
  });
  assert.deepEqual(result, { ok: true, queued: true });
  assert.deepEqual(sent, [{ version: 1, kind: 'marketing_consent.sync' }]);
  assert.doesNotMatch(JSON.stringify(sent), /@|email|recipient/i);
});

test('scheduler producer emits one PII-free global delivery sweep', async () => {
  const sent = [];
  const result = await enqueueMarketingSweep({
    MARKETING_EMAIL_QUEUE: { async send(body) { sent.push(body); } },
  });
  assert.deepEqual(result, { ok: true, queued: true });
  assert.deepEqual(sent, [{ version: 1, kind: 'marketing_delivery.sweep' }]);
});

function queueMessage(body) {
  const calls = [];
  return {
    body,
    ack() { calls.push('ack'); },
    retry(options) { calls.push(['retry', options]); },
    calls,
  };
}

test('Queue consumer ACKs committed work, emits continuation, and retries infrastructure failure', async () => {
  const message = queueMessage({
    version: 1, kind: 'marketing_delivery.drain', sourceType: 'newsletter', sourceId: 'campaign-1',
  });
  const continuations = [];
  await consumeMarketingDeliveryBatch({ messages: [message] }, {}, {
    runWorker: async (_env, _sb, options) => {
      assert.deepEqual(options, {
        sourceType: 'newsletter', sourceId: 'campaign-1', limit: 1, concurrency: 1,
      });
      return { claimed: 1, summaries: [{ complete: false, pending: 2 }] };
    },
    createClient: () => ({ marker: 'db' }),
    enqueue: async (_env, job, options) => {
      continuations.push({ job, options });
      return { ok: true, queued: true };
    },
  });
  assert.deepEqual(message.calls, ['ack']);
  assert.deepEqual(continuations, [{
    job: { sourceType: 'newsletter', sourceId: 'campaign-1' },
    options: { delaySeconds: 1 },
  }]);

  const failed = queueMessage({
    version: 1, kind: 'marketing_delivery.drain', sourceType: 'offer', sourceId: 'offer-1',
  });
  await consumeMarketingDeliveryBatch({ messages: [failed] }, {}, {
    runWorker: async () => { throw new Error('db_down'); },
    createClient: () => ({}),
  });
  assert.deepEqual(failed.calls, [['retry', { delaySeconds: 60 }]]);

  const reconcileFailed = queueMessage({
    version: 1, kind: 'marketing_delivery.drain', sourceType: 'offer',
  });
  const recovery = [];
  await consumeMarketingDeliveryBatch({ messages: [reconcileFailed] }, {}, {
    runWorker: async () => {
      const error = new Error('projection_down');
      error.deliverySourceType = 'offer';
      error.deliverySourceId = 'offer-42';
      throw error;
    },
    createClient: () => ({}),
    enqueue: async (_env, job, options) => {
      recovery.push({ job, options });
      return { ok: true, queued: true };
    },
  });
  assert.deepEqual(reconcileFailed.calls, ['ack']);
  assert.deepEqual(recovery, [{
    job: { sourceType: 'offer', sourceId: 'offer-42' },
    options: { delaySeconds: 60 },
  }]);
});

test('Queue consumer syncs one consent event and continues while work was claimed', async () => {
  const message = queueMessage({ version: 1, kind: 'marketing_consent.sync' });
  let consentRuns = 0;
  let consentWakes = 0;
  await consumeMarketingDeliveryBatch({ messages: [message] }, {}, {
    runConsentSync: async () => { consentRuns += 1; return { claimed: 1, synced: 1 }; },
    createClient: () => ({ marker: 'db' }),
    enqueueConsent: async () => { consentWakes += 1; return { ok: true, queued: true }; },
  });
  assert.deepEqual(message.calls, ['ack']);
  assert.equal(consentRuns, 1);
  assert.equal(consentWakes, 1);
});

test('global sweep claims any non-test delivery and continues as one global sweep', async () => {
  const message = queueMessage({ version: 1, kind: 'marketing_delivery.sweep' });
  const continuations = [];
  await consumeMarketingDeliveryBatch({ messages: [message] }, {}, {
    runWorker: async (_env, _sb, options) => {
      assert.deepEqual(options, { sourceType: null, sourceId: null, limit: 1, concurrency: 1 });
      return { claimed: 1, summaries: [] };
    },
    createClient: () => ({}),
    enqueueSweep: async (_env, options) => {
      continuations.push(options);
      return { ok: true, queued: true };
    },
  });
  assert.deepEqual(message.calls, ['ack']);
  assert.deepEqual(continuations, [{ delaySeconds: 1 }]);
});

test('consent sync claims DB-owned state and durably finishes provider result', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'claim_marketing_consent_sync_events') {
        return {
          data: [{
            event_id: 'db:event-1', recipient: 'reader@example.com', enabled: true, attempts: 1,
          }],
          error: null,
        };
      }
      return { data: 'synced', error: null };
    },
  };
  const result = await runMarketingConsentSync({}, sb, {
    workerId: '00000000-0000-4000-8000-000000000001',
    syncContact: async (_env, contact) => {
      assert.deepEqual(contact, { email: 'reader@example.com', enabled: true });
      return { ok: true, provider: 'ses', operation: 'updated' };
    },
  });
  assert.deepEqual(result, { claimed: 1, synced: 1, failed: 0 });
  assert.deepEqual(calls, [
    {
      name: 'claim_marketing_consent_sync_events',
      args: {
        p_worker_id: '00000000-0000-4000-8000-000000000001', p_limit: 1, p_lease_seconds: 120,
      },
    },
    {
      name: 'finish_marketing_consent_sync_event',
      args: {
        p_event_id: 'db:event-1',
        p_worker_id: '00000000-0000-4000-8000-000000000001',
        p_success: true,
        p_retryable: false,
        p_error: null,
      },
    },
  ]);
});

test('malformed Queue jobs are poison ACKed; scheduler emits one consent wake and one global sweep', async () => {
  const malformed = queueMessage({ version: 9, kind: 'bad', email: 'buyer@example.com' });
  await consumeMarketingDeliveryBatch({ messages: [malformed] }, {}, {
    runWorker: async () => { throw new Error('must_not_run'); },
    createClient: () => ({}),
  });
  assert.deepEqual(malformed.calls, ['ack']);

  let sweeps = 0;
  await scheduleMarketingDeliveryWork({}, {
    enqueueConsent: async () => ({ ok: true, queued: true }),
    enqueueSweep: async () => {
      sweeps += 1;
      return { ok: true, queued: true };
    },
  });
  assert.equal(sweeps, 1);
});

test('six-hour suppression reconciliation does not duplicate five-minute Queue wakes', async () => {
  let suppressionRuns = 0;
  let deliverySchedules = 0;
  const dependencies = {
    createClient: () => ({ marker: 'db' }),
    syncSuppressions: async () => {
      suppressionRuns += 1;
      return { ok: true, count: 0 };
    },
    schedule: async () => {
      deliverySchedules += 1;
      return ['newsletter'];
    },
  };

  assert.deepEqual(
    await runMarketingSchedule({ cron: '0 */6 * * *' }, {}, dependencies),
    { suppression: { ok: true, count: 0 }, queued: [] },
  );
  assert.equal(suppressionRuns, 1);
  assert.equal(deliverySchedules, 0);

  assert.deepEqual(
    await runMarketingSchedule({ cron: '*/5 * * * *' }, {}, dependencies),
    { suppression: null, queued: ['newsletter'] },
  );
  assert.equal(suppressionRuns, 1);
  assert.equal(deliverySchedules, 1);
});
