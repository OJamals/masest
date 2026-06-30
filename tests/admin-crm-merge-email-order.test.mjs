import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

// Regression guard for the contact-merge email-loss bug: the survivor's email backfill must
// happen AFTER the duplicate is soft-deleted, otherwise it collides with the live partial
// unique index crm_contacts(company_id, lower(email)) where deleted_at is null and the
// 23505 is swallowed — losing the email while reporting success.
test('merge retires the duplicate before backfilling the survivor', () => {
  const delIdx = src.indexOf("deleted_at: new Date().toISOString() }).eq('id', fromId)");
  const fillIdx = src.indexOf('mergeFields(into, from)');
  assert.ok(delIdx > -1 && fillIdx > -1, 'both merge steps must be present');
  assert.ok(delIdx < fillIdx, 'the loser soft-delete must precede the survivor email backfill');
});

test('merge backfill checks the write result (no swallowed unique-conflict)', () => {
  assert.match(src, /const \{ error: fillErr \} = await sb\.from\('crm_contacts'\)\.update\(fill\)/);
  assert.match(src, /if \(fillErr\) return json\(500, \{ error: fillErr\.message \}\)/);
});
