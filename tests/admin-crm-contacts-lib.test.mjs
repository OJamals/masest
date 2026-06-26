import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTACT_ROLES, ROLE_LABELS, validRole, contactRow, contactPatch } from '../functions/_lib/crm-contacts.js';

test('exposes the role vocabulary with labels', () => {
  assert.ok(CONTACT_ROLES.includes('procurement'));
  assert.ok(CONTACT_ROLES.includes('other'));
  assert.equal(ROLE_LABELS.plant_manager, 'Plant Manager');
  assert.ok(validRole('maintenance'));
  assert.ok(!validRole('ceo'));
});

test('contactRow requires company + name', () => {
  assert.equal(contactRow({ name: 'Jane' }).error, 'company_required');
  assert.equal(contactRow({ company_id: 'c1' }).error, 'name_required');
  assert.equal(contactRow({ company_id: 'c1', name: '   ' }).error, 'name_required');
});

test('contactRow validates email + coerces role/primary', () => {
  assert.equal(contactRow({ company_id: 'c1', name: 'Jane', email: 'nope' }).error, 'invalid_email');
  const { row } = contactRow({ company_id: 'c1', name: 'Jane Doe', role: 'ceo', email: 'j@acme.co', is_primary: 'true', actor: 'staff@masest.co' });
  assert.equal(row.company_id, 'c1');
  assert.equal(row.role, 'other'); // unknown role -> other
  assert.equal(row.email, 'j@acme.co');
  assert.equal(row.is_primary, true);
  assert.equal(row.created_by, 'staff@masest.co');
});

test('contactRow keeps a valid role + nulls empty optionals', () => {
  const { row } = contactRow({ company_id: 'c1', name: 'Bob', role: 'procurement', title: '', phone: '' });
  assert.equal(row.role, 'procurement');
  assert.equal(row.title, null);
  assert.equal(row.phone, null);
  assert.equal(row.is_primary, false);
});

test('contactPatch builds only provided keys + stamps updated_at', () => {
  const now = new Date('2026-06-26T00:00:00Z');
  const { patch } = contactPatch({ title: 'Buyer' }, now);
  assert.equal(patch.title, 'Buyer');
  assert.equal(patch.updated_at, '2026-06-26T00:00:00.000Z');
  assert.equal('name' in patch, false);
  assert.equal('email' in patch, false);
});

test('contactPatch validates email + empty name', () => {
  assert.equal(contactPatch({ email: 'bad' }).error, 'invalid_email');
  assert.equal(contactPatch({ name: '' }).error, 'name_required');
  const { patch } = contactPatch({ email: '', is_primary: true });
  assert.equal(patch.email, null);
  assert.equal(patch.is_primary, true);
});
