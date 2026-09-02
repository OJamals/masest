import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { customerDirectoryParams } from '../functions/api/admin/customers.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('customer directory query bounds pagination and validates profile roles', () => {
  assert.deepEqual(customerDirectoryParams('https://masest.test/api/admin/customers'), {
    q: null, role: null, limit: 50, offset: 0,
  });
  assert.deepEqual(customerDirectoryParams('https://masest.test/api/admin/customers?q=%20Acme%20&role=buyer&limit=500&offset=-3'), {
    q: 'Acme', role: 'buyer', limit: 100, offset: 0,
  });
  assert.deepEqual(customerDirectoryParams('https://masest.test/api/admin/customers?role=operator'), {
    error: 'invalid_role',
  });
});

test('interactive customer directory uses bounded RPC and page-only email resolution', () => {
  const endpoint = read('functions/api/admin/customers.js');
  assert.match(endpoint, /admin_customer_directory/);
  assert.match(endpoint, /emailsByIds\(sb, customers\.map/);
  assert.match(endpoint, /has_more/);
  assert.match(endpoint, /fullCustomerExport[\s\S]*allUserEmails\(sb/);
  assert.match(endpoint, /export.*csv[\s\S]*fullCustomerExport\(sb\)/);
  assert.doesNotMatch(endpoint, /select\('id,full_name,phone,role,company_id'\)[\s\S]*return json\(200, \{ customers \}\)/);
});

test('directory SQL searches profile, company, and Auth email server-side', () => {
  const migration = read('supabase/schema-admin-customer-directory.sql');
  assert.match(migration, /create or replace function public\.admin_customer_directory/);
  assert.match(migration, /security definer/);
  assert.match(migration, /exists\s*\([\s\S]*from auth\.users u[\s\S]*u\.id = p\.id[\s\S]*u\.email[\s\S]*ilike/);
  assert.match(migration, /count\(\*\) over\(\)/);
  assert.match(migration, /order by lower\(coalesce\(m\.company_name/);
  assert.match(migration, /grant execute on function public\.admin_customer_directory/);
  assert.match(migration, /service_role/);
});

test('portal-user UI pages server results and drops stale query or role responses', () => {
  const workspace = read('js/admin/crm-workspace.js');
  assert.match(workspace, /data-dir-users-more/);
  assert.match(workspace, /portalLoadId/);
  assert.match(workspace, /loadPortalUsers\(\{ q, offset/);
  assert.match(workspace, /admListPager\('data-dir-users-more'/);
  assert.match(workspace, /state\.crmContactQ !== q/);
  assert.match(workspace, /state\.crmContactRole !== role/);
});
