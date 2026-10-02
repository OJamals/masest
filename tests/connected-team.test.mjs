import test from 'node:test';
import assert from 'node:assert/strict';
import { handleConnectedCrm } from '../functions/_lib/connected-crm.js';
import { connectedStaffDirectory } from '../functions/_lib/connected-staff-directory.js';
const actor = '00000000-0000-4000-8000-000000000042';
const target = '00000000-0000-4000-8000-000000000043';
const env = { MASEST_CRM_ENABLED: '1', MASEST_CRM_ORIGIN: 'https://crm.example.test', MASEST_CRM_ISSUER: 'https://masest.example.test', MASEST_CRM_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001', MASEST_CRM_SIGNING_KEY: '12'.repeat(32) };
const request = (resource, body) => new Request(env.MASEST_CRM_ISSUER + '/api/admin/connected-crm?resource=' + resource, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});

test('team assignments bind freshly checked target, fail closed on revocation or directory outage', async () => {
  let eligible = true; let checks = 0; const forwarded = [];
  const deps = { requireStaff: async () => ({ user: { id: actor }, staff: true, role: 'support' }),
    staffDirectory: { eligible: async (id) => { checks++; assert.equal(id, target); if (eligible === 'error') throw new Error('PRIVATE'); return eligible; } },
    fetch: async (_url, init) => { forwarded.push(JSON.parse(Buffer.from(init.headers['X-MASEST-CRM-Assertion'].split('.')[1], 'base64url'))); return Response.json({}, { status: forwarded.at(-1).assignee ? 200 : 403 }); } };
  const body = { owner_staff_id: target, action_id: crypto.randomUUID() };
  assert.equal((await handleConnectedCrm({ request: request('sales_tasks', body), env }, deps)).status, 200);
  assert.equal(forwarded[0].assignee, target);
  eligible = false;
  assert.equal((await handleConnectedCrm({ request: request('sales_tasks', body), env }, deps)).status, 403);
  eligible = 'error';
  const failed = await handleConnectedCrm({ request: request('sales_tasks', body), env }, deps);
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('PRIVATE'));
  assert.equal(checks, 3); assert.equal(forwarded.length, 2); assert.equal(forwarded[1].assignee, undefined);
});

test('directory route is bounded, staff-only and never forwards to CRM', async () => {
  const deps = { requireStaff: async () => ({ user: { id: actor }, staff: true, role: 'read_only' }),
    staffDirectory: { list: async () => ({ items: [{ staff_id: target, display_name: 'Synthetic teammate', role: 'support' }], next_cursor: null }) },
    fetch: () => { throw new Error('unexpected CRM call'); } };
  const response = await handleConnectedCrm({ request: request('staff_directory'), env }, deps);
  assert.equal(response.status, 200); assert.equal((await response.json()).items[0].staff_id, target);
  for (const resource of ['staff_directory&limit=101', 'staff_directory&cursor=bad', 'staff_directory&workspace_id=x']) {
    assert.equal((await handleConnectedCrm({ request: request(resource), env }, deps)).status, 422);
  }
  assert.equal((await handleConnectedCrm({ request: request('staff_directory', {}), env }, deps)).status, 405);
});

test('directory adapter excludes removed/read-only/banned identities and does only bounded reads', async () => {
  const profiles = [
    { id: target, full_name: 'Synthetic teammate', is_staff: true, staff_role: 'support' },
    { id: actor, full_name: 'Read only', is_staff: true, staff_role: 'read_only' },
  ];
  let banned = false; let failure = false; let bounds;
  const sb = { auth: { admin: { getUserById: async (id) => ({ data: { user: { id, banned_until: banned ? '2999-01-01' : null } }, error: failure ? {} : null }) } },
    from: (table) => { assert.equal(table, 'profiles'); let id;
      const q = { select: () => q, eq: (key, val) => { if (key === 'id') id = val; return q; }, order: () => q,
        limit: (n) => { bounds = n; return q; }, gt: () => q,
        maybeSingle: async () => ({ data: profiles.find((p) => p.id === id), error: null }),
        then: (resolve) => resolve({ data: profiles, error: null }) }; return q; } };
  const directory = connectedStaffDirectory(sb, {});
  assert.deepEqual((await directory.list({ limit: 25 })).items.map((x) => x.staff_id), [target]);
  assert.equal(bounds, 26); assert.equal(await directory.eligible(actor), false);
  profiles[0].is_staff = false; assert.equal(await directory.eligible(target), false);
  profiles[0].is_staff = true; banned = true; assert.equal(await directory.eligible(target), false);
  banned = false; failure = true; await assert.rejects(directory.eligible(target));
});
