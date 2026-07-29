import assert from 'node:assert/strict';
import test from 'node:test';
import { createCrmActivityModule } from '../functions/_lib/crm-activity.js';

function activityStore(overrides = {}) {
  const calls = [];
  const store = {
    calls,
    async notes(subjectType, subjectId) {
      calls.push(['notes', subjectType, subjectId]);
      return [{ id: 1, body: 'Called buyer', created_at: '2026-07-20T00:00:00Z' }];
    },
    async tasks(subjectType, subjectId) {
      calls.push(['tasks', subjectType, subjectId]);
      return [{ id: 2, title: 'Follow up', created_at: '2026-07-21T00:00:00Z' }];
    },
    async companyCore(companyId) {
      calls.push(['companyCore', companyId]);
      return {
        orders: [{ id: 3, created_at: '2026-07-22T00:00:00Z' }],
        messages: [],
        audit: [],
        companyName: 'Acme',
      };
    },
    async shipments(orderIds) {
      calls.push(['shipments', orderIds]);
      return [{ order_id: 3, created_at: '2026-07-23T00:00:00Z' }];
    },
    async quotesByCompany(companyName) {
      calls.push(['quotesByCompany', companyName]);
      return [{ id: 4, created_at: '2026-07-24T00:00:00Z' }];
    },
    async companyAddresses(companyId) {
      calls.push(['companyAddresses', companyId]);
      return ['buyer@acme.co'];
    },
    async emailEvents(addresses) {
      calls.push(['emailEvents', addresses]);
      return [
        { id: 5, to_email: 'buyer@acme.co', created_at: '2026-07-25T00:00:00Z' },
        { id: 6, to_email: 'other@example.com', created_at: '2026-07-26T00:00:00Z' },
      ];
    },
    async quotesByContact(contactId) {
      calls.push(['quotesByContact', contactId]);
      return [{ id: 7, created_at: '2026-07-27T00:00:00Z' }];
    },
    ...overrides,
  };
  return store;
}

test('relationship activity module retrieves and merges a company timeline', async () => {
  const store = activityStore();
  const activity = createCrmActivityModule({ store });

  const result = await activity.timeline({ subjectType: 'company', subjectId: 'c1' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.timeline.map((item) => item.type), [
    'email:sent',
    'quote',
    'shipment',
    'order',
    'task',
    'note:note',
  ]);
  assert.deepEqual(store.calls, [
    ['notes', 'company', 'c1'],
    ['tasks', 'company', 'c1'],
    ['companyCore', 'c1'],
    ['companyAddresses', 'c1'],
    ['shipments', [3]],
    ['quotesByCompany', 'Acme'],
    ['emailEvents', ['buyer@acme.co']],
  ]);
});

test('relationship activity module retrieves contact deals without company sources', async () => {
  const store = activityStore();
  const activity = createCrmActivityModule({ store });

  const result = await activity.timeline({ subjectType: 'contact', subjectId: '42' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.timeline.map((item) => item.type), ['quote', 'task', 'note:note']);
  assert.deepEqual(store.calls, [
    ['notes', 'contact', '42'],
    ['tasks', 'contact', '42'],
    ['quotesByContact', 42],
  ]);
});

test('relationship activity module rejects invalid subjects before storage access', async () => {
  const store = activityStore();
  const activity = createCrmActivityModule({ store });

  assert.deepEqual(await activity.timeline({ subjectType: 'user', subjectId: '1' }), {
    ok: false,
    error: 'invalid_subject',
  });
  assert.deepEqual(store.calls, []);
});
