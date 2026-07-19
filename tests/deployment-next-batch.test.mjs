import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('pushes and pull requests run the complete verification gate', () => {
  const path = new URL('../.github/workflows/verify.yml', import.meta.url);
  assert.equal(existsSync(path), true, 'missing .github/workflows/verify.yml');
  const workflow = read('.github/workflows/verify.yml');
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /node-version:\s*["']?22/);
  assert.match(workflow, /npm install --no-audit --no-fund/);
  assert.doesNotMatch(workflow, /cache:\s*npm/, 'setup-node cache requires a lockfile');
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /contents:\s*read/);
});

test('business creation is one guarded database transaction', () => {
  const endpoint = read('functions/api/account/company.js');
  const migrationPath = new URL('../supabase/schema-account-company.sql', import.meta.url);
  assert.equal(existsSync(migrationPath), true, 'missing atomic company migration');
  const migration = read('supabase/schema-account-company.sql');
  assert.match(endpoint, /\.rpc\('create_company_for_user'/);
  assert.match(migration, /create or replace function public\.create_company_for_user/i);
  assert.match(migration, /update public\.profiles[\s\S]+company_id is null[\s\S]+if not found then[\s\S]+raise exception/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /grant execute on function public\.create_company_for_user\(uuid, jsonb\) to service_role/i);
});

test('newsletter deliveries recover expired leases and derive durable completion from ledger state', () => {
  const endpoint = read('functions/api/admin/newsletters.js');
  const helper = read('functions/_lib/newsletter-delivery.js');
  const schema = read('supabase/schema-newsletters.sql');
  assert.match(helper, /DELIVERY_LEASE_SECONDS/);
  assert.match(helper, /runSupabaseDeliveryWorker/);
  assert.match(endpoint, /materializeDeliverySource/);
  assert.match(endpoint, /return json\(202/);
  assert.match(schema, /state = 'processing' and delivery\.lease_expires_at <= now\(\)/);
  assert.match(schema, /for update skip locked/i);
  assert.match(schema, /newsletter_delivery_summary/);
  assert.match(schema, /count\(\*\) = count\(\*\) filter \(where state in \('sent', 'suppressed', 'dead'\)\)/);
  assert.match(endpoint, /json\(503/);
});

test('admin user directory fetches bounded pages and joins only page records', () => {
  const endpoint = read('functions/api/admin/users.js');
  const ui = read('js/admin/companies.js');
  assert.doesNotMatch(endpoint, /page\s*=\s*1;\s*page\s*<=\s*50/);
  assert.doesNotMatch(endpoint, /perPage:\s*1000/);
  assert.match(endpoint, /parsePage/);
  assert.match(endpoint, /pageEnvelope/);
  assert.match(endpoint, /listUsers\(\{\s*page,\s*perPage:\s*limit\s*\}\)/);
  assert.match(endpoint, /\.in\('id',\s*ids\)/);
  assert.match(ui, /data-load-more-users/);
  assert.match(ui, /acctUsersHasMore/);
});
