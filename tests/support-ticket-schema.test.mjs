import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sql = read('supabase/migrate-support-tickets-2026-09-06.sql');

test('support ticket migration is one additive transaction', () => {
  assert.match(sql, /^\s*--[^]*?\bbegin;/i);
  assert.match(sql, /\bcommit;\s*$/i);
  assert.doesNotMatch(sql, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:support_threads|messages)/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.messages[^;]*drop\s+column/i);
});

test('support tickets own bounded workflow fields beneath canonical threads', () => {
  assert.match(sql, /create table if not exists public\.support_tickets\s*\(/i);
  assert.match(sql, /id\s+uuid\s+primary key\s+default gen_random_uuid\(\)/i);
  assert.match(sql, /ticket_number\s+bigint\s+generated always as identity\s+unique/i);
  assert.match(sql, /thread_id\s+uuid\s+not null\s+references public\.support_threads\(id\)\s+on delete cascade/i);
  assert.match(sql, /constraint support_tickets_id_thread_unique\s+unique \(id, thread_id\)/i);
  assert.match(sql, /subject\s+text\s+not null/i);
  assert.match(sql, /char_length\(subject\) between 1 and 200/i);
  assert.match(sql, /status\s+text\s+not null\s+default 'open'/i);
  assert.match(sql, /status in \('open', 'waiting_on_customer', 'resolved'\)/i);
  assert.match(sql, /priority in \('normal', 'high', 'urgent'\)/i);
  assert.match(sql, /category in \('general', 'product', 'order', 'shipping', 'billing', 'account', 'technical'\)/i);
  assert.match(sql, /assigned_to\s+uuid\s+references public\.profiles\(id\)\s+on delete set null/i);
  assert.match(sql, /primary_order_id\s+uuid\s+references public\.orders\(id\)\s+on delete set null/i);
  assert.match(sql, /version\s+integer\s+not null\s+default 1\s+check \(version >= 1\)/i);
  assert.match(sql, /resolved_at is null or status = 'resolved'/i);
  assert.match(sql, /last_message_body\s+text/i);
  assert.match(sql, /last_sender_role\s+text/i);
  assert.doesNotMatch(sql, /needs_staff_reply\s+(?:boolean|bool)/i);
});

test('support ticket queue indexes are deterministic and do not force one active ticket', () => {
  assert.match(sql, /support_tickets_thread_created_idx\s+on public\.support_tickets\s*\(thread_id, created_at desc, id desc\)/i);
  assert.match(sql, /support_tickets_status_message_idx\s+on public\.support_tickets\s*\(status, last_message_at desc, id desc\)/i);
  assert.match(sql, /support_tickets_assignee_status_idx\s+on public\.support_tickets\s*\(assigned_to, status, last_message_at desc, id desc\)/i);
  assert.match(sql, /support_tickets_primary_order_idx\s+on public\.support_tickets\s*\(primary_order_id\)/i);
  assert.doesNotMatch(sql, /create unique index[^;]+support_tickets[^;]+where[^;]+status/i);
});

test('ticket events are bounded, append-only service-role history with parent erasure cascade', () => {
  assert.match(sql, /create table if not exists public\.support_ticket_events\s*\(/i);
  assert.match(sql, /ticket_id\s+uuid\s+not null\s+references public\.support_tickets\(id\)\s+on delete cascade/i);
  assert.match(sql, /idempotency_key\s+text\s+not null\s+unique/i);
  assert.match(sql, /char_length\(idempotency_key\) between 1 and 200/i);
  assert.match(sql, /event_type in \('created', 'status_changed', 'priority_changed', 'category_changed', 'assignment_changed', 'private_note_added'\)/i);
  assert.match(sql, /jsonb_typeof\(detail\) = 'object'/i);
  assert.match(sql, /octet_length\(detail::text\) <= 16384/i);
  assert.match(sql, /support_ticket_events_ticket_created_idx\s+on public\.support_ticket_events\s*\(ticket_id, created_at desc, id desc\)/i);
  assert.match(sql, /grant select, insert on public\.support_ticket_events to service_role/i);
  assert.doesNotMatch(sql, /grant\s+(?:update|delete|all(?: privileges)?)\s+on public\.support_ticket_events/i);
});

test('ticket tables are RLS-enabled and buyer roles receive no direct privileges', () => {
  assert.match(sql, /alter table public\.support_tickets enable row level security/i);
  assert.match(sql, /alter table public\.support_ticket_events enable row level security/i);
  assert.match(sql, /revoke all on public\.support_tickets, public\.support_ticket_events\s+from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant select, insert, update on public\.support_tickets to service_role/i);
  assert.doesNotMatch(sql, /grant[^;]+on public\.support_tickets[^;]+to (?:public|anon|authenticated)/i);
  assert.doesNotMatch(sql, /grant[^;]+on public\.support_ticket_events[^;]+to (?:public|anon|authenticated)/i);
  assert.doesNotMatch(sql, /create policy[^;]+on public\.support_ticket/i);
});

test('messages gain nullable indexed ticket linkage constrained to the same thread', () => {
  assert.match(sql, /alter table public\.messages\s+add column if not exists ticket_id uuid/i);
  assert.match(sql, /messages_ticket_idx\s+on public\.messages\s*\(ticket_id, created_at desc, id desc\)/i);
  assert.match(sql, /foreign key \(ticket_id, thread_id\)\s+references public\.support_tickets\(id, thread_id\)\s+match simple\s+on update no action\s+on delete set null \(ticket_id\)/i);
  assert.match(sql, /v_constraint\.contype <> 'f'/i);
  assert.match(sql, /v_constraint\.confrelid <> 'public\.support_tickets'::regclass/i);
  assert.match(sql, /v_constraint\.confmatchtype <> 's'/i);
  assert.match(sql, /v_constraint\.confupdtype <> 'a'/i);
  assert.match(sql, /v_constraint\.confdeltype <> 'n'/i);
  assert.match(sql, /v_constraint\.convalidated is not true/i);
  assert.match(sql, /v_constraint\.key_columns <> array\['ticket_id', 'thread_id'\]::text\[\]/i);
  assert.match(sql, /v_constraint\.referenced_columns <> array\['id', 'thread_id'\]::text\[\]/i);
  assert.match(sql, /v_constraint\.delete_set_columns <> array\['ticket_id'\]::text\[\]/i);
  assert.match(sql, /raise exception 'support_message_ticket_constraint_collision'/i);
  assert.doesNotMatch(sql, /alter column ticket_id set not null/i);
  assert.doesNotMatch(sql, /ensure_support_message_ticket_thread/i);
});

test('legacy backfill creates one neutral ticket for every participant, company, or empty thread', () => {
  const insert = sql.match(/insert into public\.support_tickets[^]*?where not exists \([^]*?\);/i)?.[0] || '';
  assert.match(insert, /select\s+thread\.id,\s*thread\.id/i);
  assert.match(insert, /'Legacy support conversation'/i);
  assert.match(insert, /case\s+when thread\.status = 'complete' then 'resolved'\s+else 'open'\s+end/i);
  assert.match(insert, /case\s+when thread\.status = 'escalated' then 'high'\s+else 'normal'\s+end/i);
  assert.match(insert, /'general'/i);
  assert.match(insert, /thread\.last_order_id/i);
  assert.match(insert, /when thread\.status = 'complete'\s+then thread\.completed_at\s+else null/i);
  assert.doesNotMatch(insert, /coalesce\(thread\.completed_at,\s*thread\.updated_at,\s*thread\.created_at\)/i);
  assert.match(insert, /thread\.created_at/i);
  assert.match(insert, /from public\.support_threads thread/i);
  assert.doesNotMatch(insert, /from public\.messages/i);
  assert.doesNotMatch(insert, /participant_user_id\s+is\s+(?:null|not null)/i);
});

test('legacy rerun preserves managed ticket state and existing valid message assignments', () => {
  assert.match(sql, /where ticket\.id = thread\.id[\s\S]*ticket\.thread_id is distinct from thread\.id[\s\S]*raise exception 'legacy_support_ticket_identity_collision'/i);
  assert.match(sql, /where not exists \(\s*select 1 from public\.support_tickets existing\s+where existing\.id = thread\.id\s*\)/i);
  assert.doesNotMatch(sql, /on conflict[^;]+do nothing/i);
  assert.doesNotMatch(sql, /update\s+public\.support_tickets\s+set/i);
  assert.match(sql, /update public\.messages message\s+set ticket_id = message\.thread_id\s+where message\.ticket_id is null/i);
  assert.match(sql, /message\.ticket_id is not null[\s\S]*ticket\.thread_id is distinct from message\.thread_id[\s\S]*raise exception 'support_message_ticket_identity_collision'/i);
});

test('legacy created events use stable keys and fail closed on collisions', () => {
  assert.match(sql, /'legacy-created\/' \|\| thread\.id::text/i);
  assert.match(sql, /event\.idempotency_key = 'legacy-created\/' \|\| thread\.id::text[\s\S]*event\.ticket_id is distinct from thread\.id[\s\S]*raise exception 'legacy_support_ticket_event_collision'/i);
  assert.match(sql, /where not exists \(\s*select 1 from public\.support_ticket_events existing\s+where existing\.idempotency_key = 'legacy-created\/' \|\| thread\.id::text\s*\)/i);
});

test('migration verifies complete legacy coverage without claiming real database execution', () => {
  assert.match(sql, /raise exception 'legacy_support_ticket_missing'/i);
  assert.match(sql, /raise exception 'support_message_ticket_backfill_incomplete'/i);
  assert.match(sql, /raise exception 'legacy_support_ticket_event_missing'/i);
});
