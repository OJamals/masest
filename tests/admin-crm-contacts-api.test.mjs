import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

test('imports the pure lib at the subfolder depth', () => {
  assert.match(src, /from '\.\.\/\.\.\/\.\.\/_lib\/crm-contacts\.js'/);
  assert.match(src, /from '\.\.\/\.\.\/\.\.\/_lib\/supabase\.js'/);
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/_lib\/crm-contacts/);
});

test('staff + write guarded like the other crm endpoints', () => {
  assert.match(src, /requireStaff/);
  assert.match(src, /staffCanWrite\(role\)/);
});

test('GET lists by company_id, primary first, with migration fallback', () => {
  assert.match(src, /url\.searchParams\.get\('company_id'\)/);
  assert.match(src, /\.eq\('company_id'/);
  assert.match(src, /\.order\('is_primary', \{ ascending: false \}\)/);
  assert.match(src, /needs_migration: true/);
});

test('POST splits create vs update on body.id', () => {
  assert.match(src, /if \(body\.id\)/);
  assert.match(src, /contactPatch\(body/);
  assert.match(src, /contactRow\(\{ \.\.\.body, actor/);
});

test('setting primary demotes siblings in the same company', () => {
  assert.match(src, /is_primary: false \}\)\.eq\('company_id'/);
  assert.match(src, /\.neq\('id', existing\.id\)/);
});

test('DELETE soft-deletes + audits', () => {
  assert.match(src, /request\.method === 'DELETE'/);
  assert.match(src, /deleted_at: new Date\(\)\.toISOString\(\)/);
  assert.match(src, /crm\.contact_delete/);
});
