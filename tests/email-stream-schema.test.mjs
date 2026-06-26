import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-email-stream.sql', import.meta.url), 'utf8');

test('adds stream column (default all) + composite (email,stream) PK', () => {
  assert.match(sql, /add column if not exists stream text not null default 'all'/);
  assert.match(sql, /drop constraint email_suppressions_pkey/);
  assert.match(sql, /add constraint email_suppressions_pkey primary key \(email, stream\)/);
});
