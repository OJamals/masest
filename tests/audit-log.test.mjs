// Admin audit log (issue #24): immutable trail of staff mutations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { recordAudit } from '../functions/_lib/audit.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- helper (executed for real against a fake client) ----
test('recordAudit writes the actor/action/target shape', async () => {
  let row;
  const sb = { from: () => ({ insert: async (r) => { row = r; return {}; } }) };
  await recordAudit(sb, { user: { id: 'u1', email: 'a@b.com' }, action: 'order.refund', targetType: 'order', targetId: 42, detail: { amount: 10 } });
  assert.equal(row.action, 'order.refund');
  assert.equal(row.actor_user_id, 'u1');
  assert.equal(row.actor_email, 'a@b.com');
  assert.equal(row.target_type, 'order');
  assert.equal(row.target_id, '42', 'target_id is stringified');
  assert.deepEqual(row.detail, { amount: 10 });
});

test('recordAudit never throws when the insert fails (best-effort)', async () => {
  const sb = { from: () => ({ insert: async () => { throw new Error('db down'); } }) };
  await recordAudit(sb, { user: { id: 'u' }, action: 'x' }); // must resolve, not reject
});

test('recordAudit no-ops without an action', async () => {
  let called = false;
  const sb = { from: () => ({ insert: async () => { called = true; } }) };
  await recordAudit(sb, { user: {}, action: '' });
  assert.equal(called, false, 'must not write an actionless event');
});

// ---- migration ----
test('audit_log migration creates the table, enables RLS, grants service_role', () => {
  const sql = read('supabase/schema-audit-log.sql');
  assert.match(sql, /create table if not exists public\.audit_log/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /grant\s+select,\s*insert\s+on\s+public\.audit_log\s+to\s+service_role/i);
});

// ---- wiring into the sensitive mutations ----
for (const [path, marker] of [
  ['functions/api/admin/users.js', /recordAudit\(sb,\s*\{\s*user,\s*action:\s*'user\.set_role'/],
  ['functions/api/admin/companies.js', /recordAudit\(sb,\s*\{\s*user,\s*action:\s*`company\./],
  ['functions/api/admin/orders.js', /recordAudit\(sb,\s*\{\s*user,\s*action:\s*'order\.refund'/],
]) {
  test(`${path} records an audit entry on its mutation`, () => {
    const src = read(path);
    assert.match(src, /import\s*\{[^}]*recordAudit[^}]*\}\s*from\s*['"][^'"]*audit\.js['"]/, 'must import recordAudit');
    assert.match(src, marker, 'must record the specific action');
  });
}

// ---- read endpoint is staff-only ----
test('admin/audit.js read endpoint is staff-guarded', () => {
  const src = read('functions/api/admin/audit.js');
  assert.match(src, /requireStaff\(\s*request\s*,\s*env\s*\)/);
  assert.match(src, /if\s*\(\s*!user\s*\)\s*return\s+json\(\s*401/);
  assert.match(src, /if\s*\(\s*!staff\s*\)\s*return\s+json\(\s*403/);
});
