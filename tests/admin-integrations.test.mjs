import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminIntegrationsHandlers } from '../functions/api/admin/integrations.js';

function tableQuery(data) {
  const query = {
    select() { return query; },
    order() { return query; },
    eq() { return query; },
    limit() { return Promise.resolve({ data, error: null }); },
  };
  return query;
}

function fakeClient({ health = [], effects = [], replay = true } = {}) {
  return {
    from(table) {
      if (table === 'integration_effects') return tableQuery(effects);
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      if (name === 'provider_integration_health') return { data: health, error: null };
      if (name === 'provider_integration_dead_letters') {
        assert.ok(args.p_limit <= 101);
        return { data: effects, error: null };
      }
      assert.equal(name, 'replay_integration_effect');
      assert.ok(args.p_actor);
      assert.ok(args.p_reason.length >= 5);
      return { data: replay, error: null };
    },
  };
}

const staff = async () => ({
  user: { id: 'staff-1', email: 'staff@example.com' },
  staff: true,
  role: 'owner',
});

test('integration health is staff-only and redacts provider results', async () => {
  const health = [{ provider: 'shipstation', unmatched_count: 1, dead_count: 1 }];
  const effects = [{
    id: 'effect-1', event_id: 'event-1', provider: 'shipstation', status: 'dead',
    provider_result: { found: false, skipped: 'unmatched_order', secret: 'never-return' },
    created_at: '2026-08-04T12:00:00Z',
  }];
  let handlers = createAdminIntegrationsHandlers({
    requireStaff: async () => ({ user: null, staff: false, role: null }),
    adminClient: () => fakeClient({ health, effects }),
  });
  let response = await handlers.get({ request: new Request('https://masest.test/api/admin/integrations'), env: {} });
  assert.equal(response.status, 401);

  handlers = createAdminIntegrationsHandlers({ requireStaff: staff, adminClient: () => fakeClient({ health, effects }) });
  response = await handlers.get({ request: new Request('https://masest.test/api/admin/integrations'), env: {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.health.find((row) => row.provider === 'shipstation').unmatched_count, 1);
  assert.equal(body.effects[0].provider_result.secret, undefined);
  assert.doesNotMatch(JSON.stringify(body), /never-return/);
});

test('dead-letter page is independent from newer completed effects and returns explicit cursor', async () => {
  const dead = Array.from({ length: 3 }, (_, index) => ({
    id: `dead-${index}`, event_id: `event-${index}`, provider: 'resend', status: 'dead',
    effect_type: 'resend_delivery_projection', created_at: `2026-08-04T12:00:0${index}Z`,
  }));
  const handlers = createAdminIntegrationsHandlers({
    requireStaff: staff,
    adminClient: () => fakeClient({ health: [], effects: dead }),
  });
  const response = await handlers.get({
    request: new Request('https://masest.test/api/admin/integrations?status=dead&limit=2'), env: {},
  });
  const body = await response.json();
  assert.equal(body.effects.length, 2);
  assert.equal(body.truncated, true);
  assert.deepEqual(body.next_cursor, { created_at: dead[1].created_at, id: dead[1].id });
});

test('dead-letter replay requires write role, actor, and reason', async () => {
  let handlers = createAdminIntegrationsHandlers({
    requireStaff: async () => ({ user: { id: 'read-1' }, staff: true, role: 'read_only' }),
    adminClient: () => fakeClient(),
  });
  let response = await handlers.post({
    request: new Request('https://masest.test/api/admin/integrations', {
      method: 'POST', body: JSON.stringify({ action: 'replay_effect', id: 'effect-1', reason: 'operator replay' }),
    }),
    env: {},
  });
  assert.equal(response.status, 403);

  handlers = createAdminIntegrationsHandlers({ requireStaff: staff, adminClient: () => fakeClient() });
  response = await handlers.post({
    request: new Request('https://masest.test/api/admin/integrations', {
      method: 'POST', body: JSON.stringify({ action: 'replay_effect', id: 'effect-1', reason: 'operator replay' }),
    }),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, replayed: 1 });
});

test('admin worker action stays bounded', async () => {
  let seen;
  const handlers = createAdminIntegrationsHandlers({
    requireStaff: staff,
    adminClient: () => fakeClient(),
    runWorker: async (input) => {
      seen = input;
      return { claimed: 0, completed: 0, retried: 0, dead: 0 };
    },
  });
  const response = await handlers.post({
    request: new Request('https://masest.test/api/admin/integrations', {
      method: 'POST', body: JSON.stringify({ action: 'run_worker', limit: 999 }),
    }),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.equal(seen.limit, 25);
});
