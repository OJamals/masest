import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/migrate-support-ticket-routing-2026-09-06.sql', import.meta.url), 'utf8');

// These are bounded source-contract checks, not PostgreSQL rollback,
// concurrency, or runtime proof. Real database proof is deferred to Plan 043.
function sqlFunction(name) {
  const marker = `create or replace function public.${name}`;
  const start = sql.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `${name} definition missing`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} terminator missing`);
  return sql.slice(start, end + 4);
}

test('routing migration makes ticket resolution the only locked thread-to-ticket authority', () => {
  assert.match(sql, /create or replace function public\.resolve_support_ticket\s*\(/i);
  const resolver = sqlFunction('resolve_support_ticket');
  assert.match(resolver, /security definer/i);
  assert.match(resolver, /set search_path = public, pg_temp/i);
  assert.match(resolver, /support_threads[\s\S]*for update[\s\S]*support_tickets[\s\S]*for update/i);
  assert.ok(
    resolver.indexOf('select ticket.thread_id into v_exact_thread_id')
      < resolver.indexOf('where id = v_exact_thread_id for update'),
    'explicit ticket must identify and lock its canonical thread first',
  );
  assert.match(resolver, /if p_ticket_id is not null[\s\S]*v_exact_thread_id[\s\S]*elsif p_thread_id is not null/i);
  assert.match(resolver, /where thread_id = v_thread\.id and status <> 'resolved'\s*order by updated_at desc, id desc limit 1 for update/i);
  assert.match(resolver, /v_ticket\.primary_order_id is distinct from p_order_id[\s\S]*support_ticket_order_mismatch/i);
  assert.match(resolver, /p_thread_id uuid[\s\S]*p_ticket_id uuid[\s\S]*p_requester_id uuid[\s\S]*p_participant_user_id uuid[\s\S]*p_company_id uuid[\s\S]*p_order_id uuid[\s\S]*p_subject text[\s\S]*p_category text[\s\S]*p_start_ticket boolean/i);
  assert.match(sql, /revoke all on function public\.resolve_support_ticket/i);
  assert.doesNotMatch(sql, /grant execute on function public\.resolve_support_ticket/i);
});

test('append remains source compatible while every message receives the resolved ticket', () => {
  const append = sqlFunction('append_support_message');
  assert.match(append, /p_thread_user_id uuid default null,\s*p_thread_id uuid default null,\s*p_ticket_id uuid default null,\s*p_subject text default null,\s*p_category text default 'general',\s*p_start_ticket boolean default false,\s*p_contract_version integer default 1/i);
  assert.match(append, /p_contract_version is null or p_contract_version not in \(1, 2\)/i);
  assert.match(append, /case when p_contract_version = 1 then null else p_start_ticket end/i);
  assert.match(append, /support_ticket_routing_not_enabled/i);
  assert.match(append, /where singleton = true for share/i);
  assert.match(append, /v_contract_version = 1 and p_start_ticket and p_ticket_id is null/i);
  assert.match(append, /case when p_thread_id is not null then null else v_thread_user_id end/i);
  assert.match(append, /case when p_sender_role = 'buyer' then p_user_id else null end/i);
  assert.match(append, /from public\.resolve_support_ticket\(/i);
  assert.match(append, /insert into public\.messages\s*\([\s\S]*thread_id, ticket_id/i);
  assert.match(append, /first_response_at = case when p_sender_role = 'staff'/i);
  assert.match(append, /last_message_at is null or last_message_at <= v_message\.created_at[\s\S]*updated_at = greatest\(updated_at, v_message\.created_at, now\(\)\)/i);
  assert.match(append, /v_reopen := v_resolution\.ticket_status = 'resolved'/i);
  assert.match(append, /if v_reopen then[\s\S]*ticket-reopened/i);
  assert.match(append, /'ticket_id', v_ticket\.id[\s\S]*'ticket', to_jsonb\(v_ticket\)/i);
  assert.doesNotMatch(append, /update public\.support_threads\s+set status/i);
});

test('reconciliation only fills nulls, preserves assigned tickets, then fails closed before NOT NULL', () => {
  assert.match(sql, /lock table public\.support_threads, public\.support_tickets,\s+public\.support_ticket_events, public\.messages\s+in share row exclusive mode/i);
  assert.match(sql, /insert into public\.support_tickets[\s\S]*where not exists[\s\S]*and exists \([\s\S]*message\.ticket_id is null/i);
  assert.match(sql, /with lifecycle_candidates as \([\s\S]*ticket\.version = 1[\s\S]*legacy-created\/[\s\S]*not exists \([\s\S]*support_ticket_events[\s\S]*update public\.support_tickets ticket/i);
  assert.match(sql, /support_ticket_routing_cutover[\s\S]*observed_thread_status[\s\S]*routing-cutover\/[\s\S]*priority_changed/i);
  assert.doesNotMatch(sql, /legacy_support_thread_lifecycle_incomplete/i);
  assert.match(sql, /resolved_at = case when candidate\.to_status = 'resolved' then candidate\.completed_at else null end/i);
  assert.match(sql, /update public\.messages message\s+set ticket_id = legacy_ticket\.id[\s\S]*where message\.ticket_id is null/i);
  assert.match(sql, /where message\.ticket_id is not null[\s\S]*raise exception 'support_message_ticket_identity_collision'/i);
  assert.match(sql, /raise exception 'support_message_ticket_backfill_incomplete'/i);
  assert.match(sql, /alter table public\.messages\s+alter column ticket_id set not null/i);
  assert.match(sql, /with latest as \([\s\S]*update public\.support_tickets ticket[\s\S]*last_message_at = latest\.created_at[\s\S]*ticket\.last_message_at is distinct/i);
  assert.doesNotMatch(sql, /select count\(\*\) into v_thread_count from public\.support_threads/i);
});

test('email replies require exact ticket identity after v2 and old mail fails closed once a thread has multiple tickets', () => {
  const inbound = sqlFunction('upsert_email_inbound_message');
  assert.match(inbound, /p_ticket_id uuid default null/i);
  assert.match(inbound, /from public\.resolve_support_ticket\(/i);
  assert.match(inbound, /case when p_ticket_id is null then null else false end/i);
  assert.match(inbound, /support_ticket_legacy_ambiguity[\s\S]*email_inbound_ticket_required/i);
  assert.match(inbound, /p_ticket_id is null and v_contract_version = 2[\s\S]*email_inbound_ticket_required/i);
  assert.match(inbound, /where singleton = true for share/i);
  assert.match(inbound, /v_message\.ticket_id is distinct from v_ticket\.id/i);
  assert.match(inbound, /external_alert_kind[\s\S]*email_delivery_id[\s\S]*email_message_id/i);
  assert.match(inbound, /last_message_at is null or last_message_at <= v_message\.created_at[\s\S]*updated_at = greatest\(updated_at, v_message\.created_at, now\(\)\)/i);
  assert.match(inbound, /v_resolution\.ticket_status = 'resolved'[\s\S]*ticket-reopened/i);
  assert.match(inbound, /'ticket_id', v_ticket\.id[\s\S]*'ticket', to_jsonb\(v_ticket\)/i);
});

test('order requests persist exact tickets but leave unprovable legacy duplicate mappings explicit', () => {
  const order = sqlFunction('create_order_support_request');
  assert.match(sql, /alter table public\.order_requests\s+add column if not exists ticket_id uuid/i);
  assert.match(order, /update public\.order_requests\s+set ticket_id = \(v_message ->> 'ticket_id'\)::uuid/i);
  assert.match(order, /ticket_mapping_state', 'unknown_legacy'/i);
  assert.match(order, /v_request\.requested_by is not distinct from p_requested_by/i);
  assert.doesNotMatch(order, /primary_order_id = p_order_id/i);
  assert.match(order, /join public\.support_threads thread on thread\.id = ticket\.thread_id/i);
  assert.match(order, /p_contract_version integer default 1/i);
  assert.match(order, /p_contract_version is null or p_contract_version not in \(1, 2\)/i);
  assert.match(order, /where singleton = true for share/i);
  assert.match(order, /p_contract_version = 1 and v_contract_version = 2[\s\S]*support_ticket_v1_contract_retired/i);
});

test('service-role ticket CAS locks thread before ticket and records state transitions', () => {
  const update = sqlFunction('update_support_ticket');
  assert.match(update, /p_ticket_id uuid[\s\S]*p_expected_version integer[\s\S]*p_actor_id uuid[\s\S]*p_status text[\s\S]*p_priority text/i);
  assert.match(update, /select thread_id into v_thread_id[\s\S]*select \* into v_thread[\s\S]*for update[\s\S]*select \* into v_ticket[\s\S]*for update/i);
  assert.match(update, /raise exception 'ticket_version_conflict'/i);
  assert.match(update, /raise exception 'support_ticket_not_found'/i);
  assert.match(update, /insert into public\.support_ticket_events/i);
});

test('quote projection preserves leased replay/finish semantics and returns exact ticket identity', () => {
  const quote = sqlFunction('deliver_quote_message_effect');
  assert.match(quote, /invalid_quote_message_effect_lease/i);
  assert.match(quote, /provider_succeeded_at is not null/i);
  assert.match(quote, /integration_effects where id = p_effect_id for update/i);
  assert.match(quote, /where singleton = true for share/i);
  assert.match(quote, /public\.append_support_message\(/i);
  assert.match(quote, /support_ticket_routing_contract/i);
  assert.match(quote, /public\.finish_integration_projection\(/i);
  assert.match(quote, /'ticket_id', v_message ->> 'ticket_id'/i);
  assert.ok(quote.indexOf('provider_succeeded_at is not null') < quote.indexOf('public.append_support_message('));
  assert.ok(quote.indexOf('public.append_support_message(') < quote.indexOf('public.finish_integration_projection('));
});

test('routing contract is monotonic and makes every old shape fail closed after v2 activation', () => {
  assert.match(sql, /create table if not exists public\.support_ticket_routing_contract/i);
  assert.match(sql, /version integer not null default 1 check \(version in \(1, 2\)\)/i);
  assert.match(sql, /create or replace function public\.activate_support_ticket_routing/i);
  const activation = sqlFunction('activate_support_ticket_routing');
  assert.match(activation, /p_expected_version is distinct from 1/i);
  assert.match(activation, /where singleton = true for update/i);
  assert.match(sql, /set version = 2, updated_at = now\(\) where singleton = true/i);
  assert.doesNotMatch(sql, /p_contract_version = 2 and v_contract_version = 1[\s\S]*set version = 2/i);
  assert.match(sql, /p_contract_version = 1 and v_contract_version = 2[\s\S]*support_ticket_v1_contract_retired/i);
  for (const name of [
    'append_support_message',
    'upsert_email_inbound_message',
    'create_order_support_request',
    'deliver_quote_message_effect',
  ]) {
    assert.match(sqlFunction(name), /support_ticket_routing_contract[\s\S]*for share/i);
  }
  assert.doesNotMatch(sql, /set version = 2[\s\S]*public\.append_support_message\(/i);
});
