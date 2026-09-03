import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrate-ses-marketing-2026-09-03.sql', import.meta.url);

test('SES suppression migration atomically suppresses and removes recipients from future fanout', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.sync_ses_suppressions\s*\(/i);
  assert.match(sql, /insert into public\.email_suppressions/i);
  assert.match(sql, /on conflict \(email, stream\) do update/i);
  assert.match(sql, /update public\.newsletter_recipients[\s\S]+set subscribed = false/i);
  assert.match(sql, /grant execute on function public\.sync_ses_suppressions\(jsonb\)[\s\S]+to service_role/i);
  assert.match(sql, /revoke all on function public\.sync_ses_suppressions\(jsonb\)[\s\S]+from public, anon, authenticated/i);
});

test('offer audience migration resolves eligible company emails without per-user Auth calls', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.marketing_company_emails\s*\(p_company_ids jsonb\)/i);
  assert.match(sql, /join auth\.users/i);
  assert.match(sql, /marketing_email_enabled is not false/i);
  assert.match(sql, /recipient\.subscribed is not false/i);
  assert.match(sql, /not exists[\s\S]+public\.email_suppressions/i);
  assert.match(sql, /grant execute on function public\.marketing_company_emails\(jsonb\)[\s\S]+to service_role/i);
  assert.match(sql, /revoke all on function public\.marketing_company_emails\(jsonb\)[\s\S]+from public, anon, authenticated/i);
});
