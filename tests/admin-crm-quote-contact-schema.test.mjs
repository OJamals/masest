import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-crm-quote-contact.sql', import.meta.url), 'utf8');

test('adds nullable contact_id to quotes idempotently + indexes it', () => {
  assert.match(sql, /alter table public\.quotes add column if not exists contact_id bigint/);
  assert.match(sql, /create index if not exists quotes_contact_idx on public\.quotes \(contact_id\)/);
  assert.doesNotMatch(sql, /not null/); // nullable link, no orphan risk on soft-delete
});
