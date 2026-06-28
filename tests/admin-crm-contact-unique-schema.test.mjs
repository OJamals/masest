// Source-contract over supabase/schema-crm-contact-unique.sql: verifies the
// partial unique index definition, target columns, WHERE predicate, and the
// presence of the duplicate pre-check query comment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SQL = readFileSync(new URL('../supabase/schema-crm-contact-unique.sql', import.meta.url), 'utf8');

test('migration declares the correct index name with IF NOT EXISTS (idempotent)', () => {
  assert.match(SQL, /create unique index if not exists crm_contacts_company_email_uniq/i);
});

test('migration targets the crm_contacts table in the public schema', () => {
  assert.match(SQL, /on public\.crm_contacts/i);
});

test('migration indexes (company_id, lower(email))', () => {
  assert.match(SQL, /\(\s*company_id\s*,\s*lower\(email\)\s*\)/i);
});

test('migration partial WHERE filters to non-null, non-deleted emails', () => {
  assert.match(SQL, /where email is not null and deleted_at is null/i);
});

test('migration includes duplicate pre-check query in a comment', () => {
  assert.match(SQL, /PRE-CHECK/i);
  assert.match(SQL, /group by company_id.*having count\(\*\) > 1/is);
});
