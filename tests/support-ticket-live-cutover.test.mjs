import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('live cutover retires predecessor support producers before replacing the enqueue function', async () => {
  const compatibility = await read('supabase/migrate-support-ticket-live-cutover-2026-09-07.sql');
  const canonical = await read('supabase/migrate-support-message-delivery-effects-2026-09-06.sql');
  const legacyDrop = compatibility.indexOf('drop trigger if exists messages_support_email_effect');
  const canonicalDrop = canonical.indexOf('drop trigger if exists messages_support_message_email_after_insert');
  const replacement = canonical.indexOf('create or replace function public.enqueue_support_message_email_effect()');
  const canonicalCreate = canonical.indexOf('create trigger messages_support_message_email_after_insert');

  assert.ok(legacyDrop >= 0, 'legacy producer must be retired explicitly');
  assert.ok(canonicalDrop >= 0, 'canonical migration must be rerun-safe');
  assert.ok(replacement >= 0, 'canonical migration must own the replacement function');
  assert.ok(canonicalCreate > replacement, 'one canonical producer is installed after replacement');
  assert.equal(canonical.match(/create trigger messages_support_message_email_after_insert/g)?.length, 1);
});

test('live cutover readiness names the final ticket producer and rejects the predecessor', async () => {
  const compatibility = await read('supabase/migrate-support-ticket-live-cutover-2026-09-07.sql');
  const sql = await read('supabase/migrate-support-message-delivery-effects-2026-09-06.sql');

  assert.match(sql, /create or replace function public\.assert_email_effects_ready\(\)/);
  assert.match(sql, /messages_support_message_email_after_insert/);
  assert.match(sql, /messages_support_email_effect/);
  assert.match(sql, /support_message_email_envelopes/);
  assert.match(sql, /support_ticket_routing_contract/);
  assert.match(sql, /attnotnull and not attisdropped/);
  assert.match(sql, /tgfoid = 'public\.enqueue_support_message_email_effect\(\)'::regprocedure/);
  assert.match(sql, /tgenabled in \('O', 'A'\)/);
  assert.match(compatibility, /support_message_legacy_effects_nonterminal/);
});

test('release runbook applies compatibility retirement before canonical 041', async () => {
  const runbook = await read('docs/support-ticket-release.md');

  assert.match(runbook, /migrate-support-ticket-live-cutover-2026-09-07\.sql/);
  assert.match(runbook, /-f supabase\/migrate-support-message-delivery-effects-2026-09-06\.sql/);
  assert.ok(runbook.indexOf('migrate-support-ticket-live-cutover-2026-09-07.sql')
    < runbook.indexOf('-f supabase/migrate-support-message-delivery-effects-2026-09-06.sql'));
});

test('write fence uses one transaction-held control-row protocol with operator-only transitions', async () => {
  const sql = await read('supabase/migrate-support-write-fence-2026-09-07.sql');

  assert.match(sql, /where singleton = true\s+for share;/);
  assert.match(sql, /where singleton = true\s+for update;/);
  assert.match(sql, /create trigger messages_support_ingress_fence/);
  assert.doesNotMatch(sql, /lock table public\.messages/i);
  assert.match(sql, /raise exception 'support_writes_paused'/);
  assert.match(sql, /revoke all on function public\.set_support_ingress_accepting\(bigint, boolean, text\)\s+from public, anon, authenticated, service_role;/);
});
