// Account self-serve (#17): address edit/set-default + active-member role change / removal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isLastAdmin, normalizeMemberRole } from '../functions/_lib/members.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- normalizeMemberRole ----
test('normalizeMemberRole only admits admin/buyer', () => {
  assert.equal(normalizeMemberRole('admin'), 'admin');
  assert.equal(normalizeMemberRole('buyer'), 'buyer');
  assert.equal(normalizeMemberRole('owner'), 'buyer');
  assert.equal(normalizeMemberRole(''), 'buyer');
  assert.equal(normalizeMemberRole(undefined), 'buyer');
});

// ---- isLastAdmin (lockout guard) ----
test('isLastAdmin is true only for the sole admin', () => {
  const members = [{ id: 'a', role: 'admin' }, { id: 'b', role: 'buyer' }];
  assert.equal(isLastAdmin(members, 'a'), true);
  assert.equal(isLastAdmin(members, 'b'), false);
});

test('isLastAdmin is false when another admin exists', () => {
  const members = [{ id: 'a', role: 'admin' }, { id: 'b', role: 'admin' }];
  assert.equal(isLastAdmin(members, 'a'), false);
  assert.equal(isLastAdmin(members, 'b'), false);
});

test('isLastAdmin tolerates empty / id type mismatch', () => {
  assert.equal(isLastAdmin([], 'a'), false);
  assert.equal(isLastAdmin(null, 'a'), false);
  assert.equal(isLastAdmin([{ id: 1, role: 'admin' }], '1'), true, 'compares ids as strings');
});

// ---- addresses.js PATCH ----
test('addresses.js handles PATCH with ownership + default reset', () => {
  const src = read('functions/api/account/addresses.js');
  assert.match(src, /method === 'PATCH'/, 'must accept PATCH');
  assert.match(src, /\.eq\('company_id', companyId\)/, 'must scope to caller company (ownership)');
  assert.match(src, /is_default:\s*false/, 'must reset other defaults of the same type');
});

// ---- team.js active-member management ----
test('team.js changes member role (PATCH) with the last-admin guard', () => {
  const src = read('functions/api/account/team.js');
  assert.match(src, /method === 'PATCH'/, 'must accept PATCH for role change');
  assert.match(src, /isLastAdmin\(/, 'must guard against demoting/removing the last admin');
  assert.match(src, /company_admin_required/, 'mutations require company admin');
});

test('team.js removes an active member by detaching the profile', () => {
  const src = read('functions/api/account/team.js');
  assert.match(src, /member_id/, 'must support removing an active member by id');
  assert.match(src, /company_id:\s*null/, 'removal detaches the profile (company_id = null)');
});

// ---- client set-default control ----
test('dashboard address list offers a Set default control', () => {
  assert.match(read('js/dashboard.js'), /data-set-default/);
});
