import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const internalRpcSignatures = [
  'admin_order_metrics\\(\\)',
  'claim_qbo_orders\\(int\\)',
  'claim_qbo_refunds\\(int\\)',
  'create_company_address\\(uuid, address_type, text, text, text, text, text, boolean\\)',
  'decrement_variant_stock\\(text, integer\\)',
  'increment_variant_stock\\(text, integer\\)',
  'place_net_order\\(uuid, uuid, text, numeric, text\\)',
];

test('internal security-definer RPCs revoke default PUBLIC execute', () => {
  const sql = read('supabase/schema-rpc-hardening.sql');
  for (const signature of internalRpcSignatures) {
    const revoke = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public`, 'i');
    const grant = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+service_role`, 'i');
    assert.match(sql, revoke, `${signature} must revoke PUBLIC execute`);
    assert.match(sql, grant, `${signature} must keep service_role execute`);
  }
});

test('quote leads stay service-role only at the table layer', () => {
  const sql = read('supabase/schema-rpc-hardening.sql') + '\n' + read('supabase/schema-quotes.sql');
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.quotes\s+from\s+anon,\s*authenticated/i);
  assert.match(sql, /grant\s+all\s+on\s+table\s+public\.quotes\s+to\s+service_role/i);
  assert.doesNotMatch(sql, /grant\s+all\s+on\s+table\s+public\.quotes\s+to\s+anon/i);
});

test('browser table grants do not include maintenance privileges', () => {
  const sql = read('supabase/schema-rpc-hardening.sql') + '\n' + read('supabase/grants.sql');
  assert.match(sql, /revoke\s+truncate,\s*references,\s*trigger,\s*maintain\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+anon,\s*authenticated/i);
});

test('current_company_id is available for authenticated RLS but not anonymous RPC', () => {
  const sql = read('supabase/schema-rpc-hardening.sql') + '\n' + read('supabase/schema.sql');
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.current_company_id\(\)\s+from\s+public/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.current_company_id\(\)\s+to\s+authenticated,\s*service_role/i);
});
