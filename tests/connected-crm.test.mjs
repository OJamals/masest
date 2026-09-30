import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { handleConnectedCrm } from '../functions/_lib/connected-crm.js';
import { requireStaff } from '../functions/_lib/supabase.js';

const env = {
  MASEST_CRM_ENABLED: '1', MASEST_CRM_ORIGIN: 'https://crm.example.test',
  MASEST_CRM_ISSUER: 'https://masest.example.test',
  MASEST_CRM_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
  MASEST_CRM_SIGNING_KEY: '12'.repeat(32),
};
const owner = { user: { id: '00000000-0000-4000-8000-000000000042' }, staff: true, role: 'owner' };
const req = (path = '?resource=people', options = {}) => new Request('https://masest.example.test/api/admin/connected-crm' + path, options);

test('sales bridge signs only allowlisted operations and checks current role on every write', async () => {
  const id = crypto.randomUUID(); let role = 'owner'; const targets = [];
  const deps = { requireStaff: async () => ({ ...owner, role }), fetch: async (url, init) => {
    const claims = JSON.parse(Buffer.from(new Headers(init.headers).get('X-MASEST-CRM-Assertion').split('.')[1], 'base64url'));
    targets.push(claims.target); assert.equal(url, env.MASEST_CRM_ORIGIN + claims.target);
    return Response.json({ id });
  } };
  for (const [query, target] of [
    ['sales_tasks&limit=25&status=open', '/v1/sales/tasks?limit=25&status=open'],
    [`sales_task&record_id=${id}`, `/v1/sales/tasks/${id}`],
    ['sales_deals', '/v1/sales/deals'], ['sales_pipelines', '/v1/sales/pipelines'],
    [`sales_board&pipeline_id=${id}`, `/v1/sales/pipelines/${id}/board`],
    [`sales_events&entity_type=task&entity_id=${id}`, `/v1/sales/events?entity_type=task&entity_id=${id}`],
  ]) {
    assert.equal((await handleConnectedCrm({ request: req('?resource=' + query), env }, deps)).status, 200);
    assert.equal(targets.at(-1), target);
  }
  const write = (resource) => req('?resource=' + resource, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  role = 'support';
  assert.equal((await handleConnectedCrm({ request: write('sales_tasks'), env }, deps)).status, 200);
  const count = targets.length;
  assert.equal((await handleConnectedCrm({ request: write('sales_pipelines'), env }, deps)).status, 403);
  role = 'read_only';
  assert.equal((await handleConnectedCrm({ request: write('sales_tasks'), env }, deps)).status, 403);
  for (const query of ['sales_task&record_id=../people', `sales_task&record_id=${id}&workspace_id=x`, 'sales_tasks&limit=1&limit=2', 'sales_tasks&owner_staff_id=bad']) {
    assert.equal((await handleConnectedCrm({ request: req('?resource=' + query), env }, deps)).status, 422);
  }
  assert.equal(targets.length, count);
});

test('disabled integration makes no identity or CRM calls', async () => {
  const fail = () => { throw new Error('unexpected I/O'); };
  const response = await handleConnectedCrm({ request: req(), env: {} }, { requireStaff: fail, fetch: fail });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'crm_not_configured');
});

test('only current platform staff can read; every request rechecks authorization', async () => {
  let checks = 0; let forwards = 0; let identity = owner;
  const deps = { requireStaff: async () => { checks++; return identity; }, fetch: async () => { forwards++; return Response.json({ items: [], next_cursor: null }); } };
  assert.equal((await handleConnectedCrm({ request: req(), env }, deps)).status, 200);
  identity = { ...owner, staff: false, role: 'admin' };
  assert.equal((await handleConnectedCrm({ request: req(), env }, deps)).status, 403);
  identity = { user: null, staff: false, role: null };
  assert.equal((await handleConnectedCrm({ request: req(), env }, deps)).status, 401);
  assert.equal(checks, 3); assert.equal(forwards, 1);
});

test('signed request binds actor, role, scope, destination, bytes and expiry without forwarding credentials', async () => {
  const body = JSON.stringify({ action_id: crypto.randomUUID(), csv_text: 'Synthetic fixture' });
  let captured;
  const response = await handleConnectedCrm({ request: req('?resource=imports', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-only', Cookie: 'session=browser-only', 'X-MASEST-CRM-Assertion': 'forged' },
  }), env }, { requireStaff: async () => owner, fetch: async (url, init) => { captured = { url, ...init }; return Response.json({ accepted: 1 }); } });
  assert.equal(response.status, 200);
  assert.equal(captured.url, 'https://crm.example.test/v1/imports');
  const headers = new Headers(captured.headers);
  assert.equal(headers.has('Authorization'), false); assert.equal(headers.has('Cookie'), false);
  assert.equal(captured.redirect, 'error');
  const [version, payload, signature] = headers.get('X-MASEST-CRM-Assertion').split('.');
  assert.equal(version, 'v1');
  assert.equal(signature, createHmac('sha256', Buffer.from(env.MASEST_CRM_SIGNING_KEY, 'hex')).update(`${version}.${payload}`).digest('base64url'));
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.sub, owner.user.id); assert.equal(claims.role, 'owner');
  assert.equal(claims.workspace_id, env.MASEST_CRM_WORKSPACE_ID);
  assert.equal(claims.aud, env.MASEST_CRM_ORIGIN); assert.equal(claims.iss, env.MASEST_CRM_ISSUER);
  assert.equal(claims.exp - claims.iat, 30); assert.equal(claims.method, 'POST');
  assert.equal(claims.target, '/v1/imports');
  assert.equal(new TextDecoder().decode(captured.body), body);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('rejects unknown routes, scope injection, duplicate parameters and read-only writes before forwarding', async () => {
  const deps = { requireStaff: async () => ({ ...owner, role: 'read_only' }), fetch: () => { throw new Error('unexpected forward'); } };
  for (const path of ['?resource=jobs', '?resource=people&workspace_id=x', '?resource=people&limit=1&limit=2', '?resource=people&limit=101']) {
    assert.equal((await handleConnectedCrm({ request: req(path), env }, deps)).status, 422);
  }
  assert.equal((await handleConnectedCrm({ request: req('?resource=imports', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }), env }, deps)).status, 403);
});

test('bounds body bytes, rejects cross-origin requests and redacts network failures', async () => {
  const deps = { requireStaff: async () => owner, fetch: () => { throw new Error('secret transport diagnostics'); } };
  assert.equal((await handleConnectedCrm({ request: req('', { headers: { Origin: 'https://attacker.example.test' } }), env }, deps)).status, 403);
  const huge = req('?resource=imports', { method: 'POST', body: 'x'.repeat(1_200_001), headers: { 'Content-Type': 'application/json' } });
  assert.equal((await handleConnectedCrm({ request: huge, env }, deps)).status, 413);
  const failed = await handleConnectedCrm({ request: req(), env }, deps);
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /secret/);
});

test('service errors preserve structured contract and strip upstream cookies', async () => {
  const response = await handleConnectedCrm({ request: req(), env }, {
    requireStaff: async () => owner,
    fetch: async () => Response.json({ error: { code: 'cursor_invalid', message: 'Invalid cursor' } }, { status: 422, headers: { 'Set-Cookie': 'evil=1' } }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'cursor_invalid');
  assert.equal(response.headers.has('Set-Cookie'), false);
});

test('actual staff lookup performs only existing Auth/profile reads; CRM writes leave Supabase', async (t) => {
  const identityCalls = [];
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = options.method || 'GET';
    identityCalls.push([method, url.pathname]);
    assert.equal(method, 'GET', 'No Supabase writes permitted');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner.user.id, email: 'staff@example.test' });
    if (url.pathname === '/rest/v1/profiles') return Response.json({ is_staff: true, staff_role: 'support' });
    throw new Error('Unexpected identity endpoint');
  });
  let forwarded = 0;
  const response = await handleConnectedCrm({
    request: req('?resource=imports', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' } }),
    env: { ...env, SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' },
  }, { requireStaff, fetch: async () => { forwarded++; return Response.json({ accepted: 0 }); } });
  assert.equal(response.status, 200);
  assert.equal(forwarded, 1);
  assert.deepEqual(identityCalls, [['GET', '/auth/v1/user'], ['GET', '/rest/v1/profiles']]);
});

test('person review forwards only typed IDs and allowlisted read sections', async () => {
  const id = '00000000-0000-4000-8000-000000000043';
  const forwarded = [];
  const deps = { requireStaff: async () => ({ ...owner, role: 'read_only' }), fetch: async (url, init) => {
    forwarded.push(url);
    const claims = JSON.parse(Buffer.from(new Headers(init.headers).get('X-MASEST-CRM-Assertion').split('.')[1], 'base64url'));
    assert.equal(claims.target, new URL(url).pathname + new URL(url).search);
    return Response.json({ items: [], next_cursor: null });
  } };
  for (const resource of ['person', 'contacts', 'evidence', 'assertions']) {
    const response = await handleConnectedCrm({ request: req(`?resource=${resource}&person_id=${id}`), env }, deps);
    assert.equal(response.status, 200);
    assert.equal(forwarded.at(-1), env.MASEST_CRM_ORIGIN + `/v1/people/${id}${resource === 'person' ? '' : '/' + resource}`);
  }
  for (const query of [
    '?resource=person', '?resource=person&person_id=../jobs', `?resource=person&person_id=${id}&q=unbounded`,
    `?resource=evidence&person_id=${id}&limit=51`, `?resource=assertions&person_id=${id}&person_id=${id}`,
    `?resource=people&person_id=${id}`, `?resource=person&person_id=${id}&workspace_id=other`,
  ]) assert.equal((await handleConnectedCrm({ request: req(query), env }, deps)).status, 422);
  assert.equal(forwarded.length, 4);
  assert.equal((await handleConnectedCrm({ request: req(`?resource=person&person_id=${id}`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }), env }, deps)).status, 422);
});
