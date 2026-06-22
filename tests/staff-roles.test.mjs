// Admin staff role tiers (#21): per-capability checks instead of binary requireStaff.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { STAFF_ROLES, normalizeStaffRole, staffCan } from '../functions/_lib/authz.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- normalizeStaffRole ----
test('normalizeStaffRole passes through known roles (case-insensitive)', () => {
  for (const r of STAFF_ROLES) assert.equal(normalizeStaffRole(r), r);
  assert.equal(normalizeStaffRole('Finance'), 'finance');
  assert.equal(normalizeStaffRole(' READ_ONLY '), 'read_only');
});

test('normalizeStaffRole defaults unknown/blank to owner (legacy staff keep access)', () => {
  assert.equal(normalizeStaffRole(''), 'owner');
  assert.equal(normalizeStaffRole(null), 'owner');
  assert.equal(normalizeStaffRole('superuser'), 'owner');
});

// ---- staffCan capability matrix ----
test('owner can do everything', () => {
  for (const cap of ['order.refund', 'company.credit', 'product.write', 'user.role']) {
    assert.equal(staffCan('owner', cap), true, cap);
  }
});

test('finance can refund + change credit, but not product writes or role changes', () => {
  assert.equal(staffCan('finance', 'order.refund'), true);
  assert.equal(staffCan('finance', 'company.credit'), true);
  assert.equal(staffCan('finance', 'product.write'), false);
  assert.equal(staffCan('finance', 'user.role'), false);
});

test('support and read_only are barred from all four dangerous capabilities', () => {
  for (const role of ['support', 'read_only']) {
    for (const cap of ['order.refund', 'company.credit', 'product.write', 'user.role']) {
      assert.equal(staffCan(role, cap), false, `${role}/${cap}`);
    }
  }
});

test('unknown capability is owner-only (fail-safe)', () => {
  assert.equal(staffCan('owner', 'mystery.cap'), true);
  assert.equal(staffCan('finance', 'mystery.cap'), false);
});

// ---- requireStaff resolves a role ----
test('requireStaff resolves and returns a role from env owner + DB staff_role', () => {
  const src = read('functions/_lib/supabase.js');
  assert.match(src, /staff_role/, 'must read profiles.staff_role');
  assert.match(src, /normalizeStaffRole\(/, 'must normalize the DB role');
  assert.match(src, /role:\s*'owner'/, 'env ADMIN_EMAILS members resolve to owner');
});

// ---- endpoint capability gates ----
for (const [path, cap] of [
  ['functions/api/admin/orders.js', 'order.refund'],
  ['functions/api/admin/companies.js', 'company.credit'],
  ['functions/api/admin/products.js', 'product.write'],
  ['functions/api/admin/users.js', 'user.role'],
]) {
  test(`${path} gates its mutation with staffCan('${cap}')`, () => {
    const src = read(path);
    assert.match(src, /import\s*\{[^}]*staffCan[^}]*\}\s*from\s*['"][^'"]*authz\.js['"]/, 'must import staffCan');
    assert.match(src, new RegExp(`staffCan\\(\\s*role\\s*,\\s*'${cap.replace('.', '\\.')}'\\s*\\)`), `must check ${cap}`);
  });
}

// ---- migration ----
test('schema-staff-roles.sql adds staff_role with a value constraint', () => {
  const sql = read('supabase/schema-staff-roles.sql');
  assert.match(sql, /add column if not exists staff_role text/i);
  assert.match(sql, /check\s*\(\s*staff_role is null or staff_role in/i);
});
