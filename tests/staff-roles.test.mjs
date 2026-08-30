// Admin staff role tiers (#21): per-capability checks instead of binary requireStaff.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  STAFF_ROLES,
  normalizeStaffRole,
  platformStaffRole,
  staffAccessSummary,
  staffCan,
} from '../functions/_lib/authz.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- normalizeStaffRole ----
test('normalizeStaffRole passes through known roles (case-insensitive)', () => {
  for (const r of STAFF_ROLES) assert.equal(normalizeStaffRole(r), r);
  assert.equal(normalizeStaffRole('Finance'), 'finance');
  assert.equal(normalizeStaffRole(' READ_ONLY '), 'read_only');
});

test('normalizeStaffRole rejects unknown and blank roles', () => {
  assert.equal(normalizeStaffRole(''), null);
  assert.equal(normalizeStaffRole(null), null);
  assert.equal(normalizeStaffRole('superuser'), null);
});

test('platformStaffRole requires both staff membership and an explicit role', () => {
  assert.equal(platformStaffRole({ is_staff: true, staff_role: 'support' }), 'support');
  assert.equal(platformStaffRole({ is_staff: true, staff_role: null }), null);
  assert.equal(platformStaffRole({ is_staff: true, staff_role: 'superuser' }), null);
  assert.equal(platformStaffRole({ is_staff: false, staff_role: 'owner' }), null);
  assert.equal(platformStaffRole(null), null);
});

// ---- staffCan capability matrix ----
test('owner can do everything', () => {
  for (const cap of ['order.refund', 'company.credit', 'promotion.write', 'product.write', 'user.role', 'company.view_as']) {
    assert.equal(staffCan('owner', cap), true, cap);
  }
});

test('finance can refund + change credit, but not product writes or role changes', () => {
  assert.equal(staffCan('finance', 'order.refund'), true);
  assert.equal(staffCan('finance', 'company.credit'), true);
  assert.equal(staffCan('finance', 'promotion.write'), true);
  assert.equal(staffCan('finance', 'company.view_as'), true);
  assert.equal(staffCan('finance', 'product.write'), false);
  assert.equal(staffCan('finance', 'user.role'), false);
});

test('support can view-as, but cannot mutate dangerous paths', () => {
  assert.equal(staffCan('support', 'company.view_as'), true);
  for (const cap of ['order.refund', 'company.credit', 'promotion.write', 'product.write', 'user.role']) {
    assert.equal(staffCan('support', cap), false, `support/${cap}`);
  }
});

test('read_only is barred from support view-as and dangerous capabilities', () => {
  for (const cap of ['company.view_as', 'order.refund', 'company.credit', 'promotion.write', 'product.write', 'user.role']) {
    assert.equal(staffCan('read_only', cap), false, `read_only/${cap}`);
  }
});

test('dangerous capabilities remain denied to support/read_only', () => {
  for (const role of ['support', 'read_only']) {
    for (const cap of ['order.refund', 'company.credit', 'promotion.write', 'product.write', 'user.role']) {
      assert.equal(staffCan(role, cap), false, `${role}/${cap}`);
    }
  }
});

test('unknown capability is owner-only (fail-safe)', () => {
  assert.equal(staffCan('owner', 'mystery.cap'), true);
  assert.equal(staffCan('finance', 'mystery.cap'), false);
});

test('staffAccessSummary exposes only the current role capabilities', () => {
  const owner = staffAccessSummary('owner', 'OWNER@EXAMPLE.COM');
  assert.equal(owner.role, 'owner');
  assert.equal(owner.email, 'owner@example.com');
  assert.equal(owner.can_write, true);
  assert.ok(owner.capabilities.includes('product.write'));
  assert.ok(owner.capabilities.includes('user.manage'));
  assert.ok(owner.capabilities.includes('integration.configure'));

  const support = staffAccessSummary('support', 'support@example.com');
  assert.equal(support.can_write, true);
  assert.ok(support.capabilities.includes('order.write'));
  assert.ok(support.capabilities.includes('company.view_as'));
  assert.ok(!support.capabilities.includes('company.credit'));
  assert.ok(!support.capabilities.includes('product.write'));
  assert.ok(!support.capabilities.includes('integration.configure'));

  const readOnly = staffAccessSummary('read_only');
  assert.equal(readOnly.can_write, false);
  assert.deepEqual(readOnly.capabilities, ['order.read']);

  const invalid = staffAccessSummary('superuser');
  assert.equal(invalid.role, null);
  assert.equal(invalid.can_write, false);
  assert.deepEqual(invalid.capabilities, []);
});

test('stats attaches per-user access context after the org-wide cache lookup', () => {
  const src = read('functions/api/admin/stats.js');
  const cacheIndex = src.search(/cached\(env, 'cache:admin:stats:v\d+'/);
  const contextIndex = src.indexOf('staffAccessSummary(role, user.email)');
  assert.ok(cacheIndex > -1 && contextIndex > cacheIndex, 'role context must never enter the shared cached payload');
});

// ---- requireStaff resolves a role ----
test('requireStaff resolves and returns a role from env owner + DB staff_role', () => {
  const src = read('functions/_lib/supabase.js');
  assert.match(src, /staff_role/, 'must read profiles.staff_role');
  assert.match(src, /platformStaffRole\(/, 'must require explicit DB staff membership and role');
  assert.match(src, /role:\s*'owner'/, 'env ADMIN_EMAILS members resolve to owner');
});

// ---- endpoint capability gates ----
for (const [path, cap] of [
  ['functions/_lib/staff-order-operations.js', 'order.refund'],
  ['functions/api/admin/companies.js', 'company.credit'],
  ['functions/api/admin/coupons.js', 'promotion.write'],
  ['functions/api/admin/products.js', 'product.write'],
  ['functions/api/admin/users.js', 'user.role'],
  ['functions/api/admin/impersonate.js', 'company.view_as'],
]) {
  test(`${path} gates its mutation with staffCan('${cap}')`, () => {
    const src = read(path);
    assert.match(src, /import\s*\{[^}]*staffCan[^}]*\}\s*from\s*['"][^'"]*authz\.js['"]/, 'must import staffCan');
    assert.match(src, new RegExp(`staffCan\\(\\s*role\\s*,\\s*'${cap.replace('.', '\\.')}'\\s*\\)`), `must check ${cap}`);
  });
}

test('finance/owner company tax mutation remains capability-gated and audited', () => {
  assert.equal(staffCan('finance', 'company.credit'), true);
  assert.equal(staffCan('owner', 'company.credit'), true);

  const src = read('functions/api/admin/companies.js');
  const gate = src.indexOf("staffCan(role, 'company.credit')");
  const assignment = src.indexOf('patch.tax_exempt = Boolean(body.tax_exempt)', gate);
  const audit = src.indexOf('await recordAudit', assignment);
  assert.ok(gate > -1, 'staff route must require company.credit');
  assert.ok(assignment > gate, 'staff-owned tax assignment must remain behind the capability gate');
  assert.ok(audit > assignment, 'staff-owned tax mutation must remain audited');
});

// ---- migration ----
test('schema-staff-roles.sql adds staff_role with a value constraint', () => {
  const sql = read('supabase/schema-staff-roles.sql');
  assert.match(sql, /add column if not exists staff_role text/i);
  assert.match(sql, /check\s*\(\s*staff_role is null or staff_role in/i);
});

test('explicit staff-role migration preserves legacy staff then requires a role', () => {
  const sql = read('supabase/schema-staff-roles-explicit.sql');
  assert.match(sql, /update\s+public\.profiles\s+set\s+staff_role\s*=\s*'owner'/i);
  assert.match(sql, /where\s+is_staff\s+is\s+true\s+and\s+staff_role\s+is\s+null/i);
  assert.match(sql, /check\s*\(\s*is_staff\s+is\s+not\s+true\s+or\s+staff_role\s+is\s+not\s+null\s*\)/i);
});
