#!/usr/bin/env node
/*
 * Disposable PostgreSQL proof for Plan 041.
 *
 * The fixture supplies only pre-039 tables/enums.  The generic ledger and both
 * support migrations are loaded from their checked-in SQL files; this harness
 * never substitutes an RPC body.  A failed prerequisite application is a STOP.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { startOwnedPostgres } from './support-db-harness.mjs';

const { Client } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = (name) => join(root, 'supabase', name);
const migrations = [
  'schema-integration-events.sql',
  'migrate-support-write-fence-2026-09-07.sql',
  'migrate-support-tickets-2026-09-06.sql',
  'migrate-support-ticket-routing-2026-09-06.sql',
  'migrate-support-message-delivery-effects-2026-09-06.sql',
];
const ids = {
  company: '00000000-0000-4000-8000-000000000041',
  buyer: '10000000-0000-4000-8000-000000000041',
  thread: '20000000-0000-4000-8000-000000000041',
  order: '30000000-0000-4000-8000-000000000041',
  quote: '40000000-0000-4000-8000-000000000041',
  quoteRollback: '40000000-0000-4000-8000-000000000042',
  sameTimeTicket: '50000000-0000-4000-8000-000000000041',
  sameTimeFirst: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  sameTimeReply: '00000000-0000-4000-8000-000000000042',
};

const fixture = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create type public.message_sender as enum ('buyer', 'staff');
create type public.notification_type as enum ('order', 'message', 'offer', 'account', 'system');
create table public.companies (
  id uuid primary key, name text not null default 'Proof Co',
  support_thread_status text not null default 'open', support_thread_completed_at timestamptz,
  support_thread_completed_by uuid, support_last_message_at timestamptz,
  support_last_message_body text, support_last_sender_role text
);
create table public.profiles (
  id uuid primary key, company_id uuid references public.companies(id),
  full_name text, email text, notify_admin_support_requests boolean default true,
  notify_admin_messages boolean default true
);
alter table public.companies add constraint companies_completed_by_fk
  foreign key (support_thread_completed_by) references public.profiles(id) on delete set null;
create table public.orders (
  id uuid primary key, company_id uuid references public.companies(id),
  user_id uuid references public.profiles(id), order_number text, status text default 'paid',
  customer_email text, created_at timestamptz not null default now()
);
create table public.support_threads (
  id uuid primary key default gen_random_uuid(), participant_user_id uuid references public.profiles(id),
  company_id uuid references public.companies(id), status text not null default 'open',
  completed_at timestamptz, completed_by uuid references public.profiles(id),
  last_order_id uuid references public.orders(id), last_message_at timestamptz,
  last_message_body text, last_sender_role text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Pre-039 participant-thread migration prerequisites used by the real 040
-- resolve_support_ticket ON CONFLICT targets.
create unique index support_threads_participant_unique
  on public.support_threads(participant_user_id) where participant_user_id is not null;
create unique index support_threads_company_unique
  on public.support_threads(company_id) where participant_user_id is null;
create table public.messages (
  id uuid primary key default gen_random_uuid(), thread_id uuid references public.support_threads(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  recipient_user_id uuid references public.profiles(id) on delete set null,
  sender_role public.message_sender not null, body text not null,
  order_id uuid references public.orders(id) on delete set null, source text not null default 'dashboard',
  external_message_id text, external_alert_kind text, email_references text,
  email_delivery_id text, email_message_id text,
  read_by_staff boolean not null default false, read_by_user boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index messages_email_reply_id_idx on public.messages(external_message_id)
  where source = 'email_reply' and external_message_id is not null;
create table public.order_requests (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
  type text not null, reason text not null, line_items jsonb not null default '[]',
  requested_by uuid references public.profiles(id), requested_email text, status text not null default 'open',
  created_at timestamptz not null default now()
);
create unique index order_requests_open_idx on public.order_requests(order_id, type) where status = 'open';
create table public.notifications (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  user_id uuid references public.profiles(id), type public.notification_type not null default 'system',
  title text not null, body text, link text, read boolean not null default false, created_at timestamptz not null default now()
);
create table public.quotes (id uuid primary key, payload jsonb not null);
create table public.stripe_webhook_effects (
  id uuid primary key default gen_random_uuid(), stripe_event_id text not null, effect_key text not null,
  effect_type text not null, payload jsonb not null default '{}', depends_on_effect_key text,
  status text not null default 'pending', attempt_count integer not null default 0,
  available_at timestamptz not null default now(), lease_owner text, lease_expires_at timestamptz,
  provider_succeeded_at timestamptz, provider_result jsonb, last_error_code text,
  completed_at timestamptz, dead_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;

async function apply(client, name) {
  const body = await readFile(sqlPath(name), 'utf8');
  try {
    await client.query(body);
  } catch (error) {
    throw new Error(`STOP: actual prerequisite ${name} failed to apply: ${error.message}`);
  }
}

async function applyRealFunction(client, name, functionName) {
  const body = await readFile(sqlPath(name), 'utf8');
  const marker = `create or replace function public.${functionName}`;
  const start = body.toLowerCase().indexOf(marker);
  const end = body.indexOf('\n$$;', start);
  assert.notEqual(start, -1, `${functionName} missing from ${name}`);
  assert.notEqual(end, -1, `${functionName} terminator missing from ${name}`);
  await client.query(body.slice(start, end + 4));
}

async function one(client, text, params = []) {
  const result = await client.query(text, params);
  assert.equal(result.rowCount, 1, `expected one row for ${text.slice(0, 80)}`);
  return result.rows[0];
}

async function fixtureState(client) {
  const rows = async (text) => (await client.query(text)).rows;
  return {
    companies: await rows('select * from public.companies order by id'),
    supportThreads: await rows('select * from public.support_threads order by id'),
    messages: await rows('select * from public.messages order by id'),
    supportTickets: await rows('select * from public.support_tickets order by id'),
    supportTicketEvents: await rows('select * from public.support_ticket_events order by id'),
    integrationEvents: await rows('select * from public.integration_events order by id'),
    integrationEffects: await rows('select * from public.integration_effects order by id'),
    notifications: await rows('select * from public.notifications order by id'),
    orders: await rows('select * from public.orders order by id'),
    orderRequests: await rows('select * from public.order_requests order by id'),
    quotes: await rows('select * from public.quotes order by id'),
    quoteProjections: await rows(`
      select effect.id, effect.event_id, effect.status, effect.attempt_count,
             effect.lease_owner, effect.lease_expires_at,
             effect.provider_succeeded_at, effect.provider_result,
             event.status as event_status, event.processed_at as event_processed_at
        from public.integration_effects effect
        join public.integration_events event on event.id = effect.event_id
       where effect.effect_type = 'quote_message'
       order by effect.id
    `),
  };
}

async function main() {
  const cluster = await startOwnedPostgres({ prefix: 'masest-support-effects-' });
  let client;
  let peer;
  try {
    client = new Client(cluster.clientConfig);
    await client.connect();
    await client.query(fixture);

    // Apply real generic ledger + 039/040 bodies before 041.  Do not continue on a prerequisite error.
    await apply(client, migrations[0]);
    // 040's real quote writer delegates its provider acknowledgement to this
    // exact checked-in generic projection helper. Loading only that function
    // avoids fabricating its behavior or building unrelated ShipStation/QBO fixtures.
    await applyRealFunction(client, 'schema-provider-inbox.sql', 'finish_integration_projection');
    await apply(client, migrations[1]);
    for (const migration of migrations.slice(2, 4)) await apply(client, migration);

    await client.query(`insert into public.companies(id, name) values ($1, 'Proof Co')`, [ids.company]);
    await client.query(`insert into public.profiles(id, company_id, full_name, email) values ($1,$2,'Buyer','buyer@example.test')`, [ids.buyer, ids.company]);
    await client.query(`insert into public.orders(id, company_id, user_id, order_number, customer_email) values ($1,$2,$3,'ORD-041','buyer@example.test')`, [ids.order, ids.company, ids.buyer]);
    await client.query(`insert into public.support_threads(id, participant_user_id, company_id) values ($1,$2,$3)`, [ids.thread, ids.buyer, ids.company]);
    const activation = await one(client, 'select public.activate_support_ticket_routing(1) result');
    assert.equal(activation.result?.version, 2, 'fixture-only 040 activation failed');
    const historical = await one(client, `select public.append_support_message($1,$2,'buyer','Historical pre-cutover message',$3,'dashboard',false,null,$2,$4,null,'Historical','general',true,2) result`, [ids.company, ids.buyer, ids.order, ids.thread]);

    const before = await one(client, `select count(*)::int as count from public.integration_events where provider = 'masest'`);
    assert.equal(before.count, 0, '041 must not create a historical backlog');
    await apply(client, migrations[4]);
    await apply(client, migrations[4]);
    const afterMigration = await one(client, `select count(*)::int as count from public.integration_events where provider = 'masest'`);
    assert.equal(afterMigration.count, 0, '041 migration backfilled a historical message');
    const historicalClaim = await one(client, `select public.claim_support_message_email_effect($1,'proof-legacy',60) result`, [historical.result.id]);
    assert.equal(historicalClaim.result?.state, 'legacy', 'pre-cutover duplicate fabricated durability');

    // The four real writers: account append, inbound email, order request, and quote projection.
    const append = await one(client, `select public.append_support_message($1,$2,'buyer','Account writer proof',$3,'dashboard',false,null,$2,$4,$5,'Support','general',false,2) result`, [ids.company, ids.buyer, ids.order, ids.thread, historical.result.ticket_id]);
    const inbound = await one(client, `select public.upsert_email_inbound_message($1,$2,'<inbound-041@example.test>','Inbound writer proof','buyer',null,$3,null,$4,$5) result`, [ids.company, ids.buyer, ids.order, ids.thread, append.result.ticket_id]);
    const order = await one(client, `select public.create_order_support_request($1,'cancel','I need this order cancelled','[]'::jsonb,$2,'buyer@example.test','Order writer proof',2) result`, [ids.order, ids.buyer]);
    assert.ok(append.result?.id && inbound.result?.id && order.result?.message?.id, 'actual writer did not persist a message');

    await client.query(`insert into public.quotes(id, payload) values ($1, jsonb_build_object('company_id',$2::text))`, [ids.quote, ids.company]);
    const quoteEvent = await one(client, `select public.ingest_integration_event('masest','proof','quote-041','quote.ready',$1,now(),null,encode(extensions.digest('quote-041','sha256'),'hex'),'{}',jsonb_build_array(jsonb_build_object('effect_key','quote-message','effect_type','quote_message','aggregate_type','quote','aggregate_id',$1::text,'payload',jsonb_build_object('company_id',$2::text,'quote_id',$1::text)))) as id`, [ids.quote, ids.company]);
    const quoteClaims = await client.query(`select * from public.claim_integration_effects('proof-quote',25,60)`);
    const quoteEffect = quoteClaims.rows.find((row) => row.event_id === quoteEvent.id);
    assert.ok(quoteEffect, 'generic batch did not claim the real quote-message effect');
    const quoteDelivery = await one(client, `select public.deliver_quote_message_effect($1,'proof-quote') result`, [quoteEffect.id]);

    await client.query(`update public.support_tickets set status='resolved', resolved_at=now() where id=$1`, [append.result.ticket_id]);
    const reopened = await one(client, `select public.append_support_message($1,$2,'buyer','Reopened writer proof',$3,'dashboard',false,null,$2,$4,$5,'Reopened','general',false,2) result`, [ids.company, ids.buyer, ids.order, ids.thread, append.result.ticket_id]);
    await client.query(`insert into public.support_tickets(id,thread_id,subject) values ($1,$2,'Same-time ordering proof')`, [ids.sameTimeTicket, ids.thread]);
    await client.query(`insert into public.messages(id,thread_id,ticket_id,company_id,user_id,sender_role,body,source,created_at) values ($1,$2,$3,$4,$5,'buyer','First same-time message','proof','2026-09-06T12:00:00Z')`, [ids.sameTimeFirst, ids.thread, ids.sameTimeTicket, ids.company, ids.buyer]);
    await client.query(`insert into public.messages(id,thread_id,ticket_id,company_id,user_id,sender_role,body,source,created_at) values ($1,$2,$3,$4,$5,'buyer','Lower UUID same-time reply','proof','2026-09-06T12:00:00Z')`, [ids.sameTimeReply, ids.thread, ids.sameTimeTicket, ids.company, ids.buyer]);

    // A quote projection is another enclosing writer transaction: if its delegated
    // support append cannot enqueue, neither the quote projection nor message moves.
    await client.query(`insert into public.quotes(id, payload) values ($1, jsonb_build_object('company_id',$2::text))`, [ids.quoteRollback, ids.company]);
    const quoteRollbackEvent = await one(client, `select public.ingest_integration_event('masest','proof','quote-041-rollback','quote.ready',$1,now(),null,encode(extensions.digest('quote-041-rollback','sha256'),'hex'),'{}',jsonb_build_array(jsonb_build_object('effect_key','quote-message','effect_type','quote_message','aggregate_type','quote','aggregate_id',$1::text,'payload',jsonb_build_object('company_id',$2::text,'quote_id',$1::text)))) as id`, [ids.quoteRollback, ids.company]);
    const quoteRollbackClaims = await client.query(`select * from public.claim_integration_effects('proof-quote-rollback',25,60)`);
    const quoteRollbackEffect = quoteRollbackClaims.rows.find((row) => row.event_id === quoteRollbackEvent.id);
    assert.ok(quoteRollbackEffect, 'generic batch did not claim the rollback quote-message effect');
    const beforeEffectFailure = await fixtureState(client);
    await client.query('begin');
    await client.query(`update public.messages set body='Snapshot sensitivity mutation' where id=$1`, [append.result.id]);
    await client.query(`insert into public.support_ticket_events(ticket_id,idempotency_key,event_type,detail) values ($1,'proof-snapshot-sensitivity','private_note_added','{}')`, [append.result.ticket_id]);
    const changedFixtureState = await fixtureState(client);
    assert.notDeepEqual(changedFixtureState.messages, beforeEffectFailure.messages, 'rollback snapshot is blind to message mutations');
    assert.notDeepEqual(changedFixtureState.supportTicketEvents, beforeEffectFailure.supportTicketEvents, 'rollback snapshot is blind to ticket-event mutations');
    await client.query('rollback');
    assert.deepEqual(await fixtureState(client), beforeEffectFailure, 'snapshot sensitivity transaction did not restore fixture state');
    await client.query(`create function public.proof_reject_support_effect() returns trigger language plpgsql as $$ begin raise exception 'proof_effect_failure'; end $$`);
    await client.query(`create trigger proof_reject_support_effect before insert on public.integration_effects for each row when (new.effect_type='support_message_email') execute function public.proof_reject_support_effect()`);
    await assert.rejects(
      client.query(`select public.append_support_message($1,$2,'buyer','Effect rollback proof',$3,'dashboard',false,null,$2,$4,$5,'Rollback','general',false,2)`, [ids.company, ids.buyer, ids.order, ids.thread, append.result.ticket_id]),
      /proof_effect_failure/,
    );
    await assert.rejects(
      client.query(`select public.create_order_support_request($1,'return','Effect rollback must include request state','[]'::jsonb,$2,'buyer@example.test','Order effect rollback proof',2)`, [ids.order, ids.buyer]),
      /proof_effect_failure/,
    );
    await assert.rejects(
      client.query(`select public.deliver_quote_message_effect($1,'proof-quote-rollback')`, [quoteRollbackEffect.id]),
      /proof_effect_failure/,
    );
    await client.query('drop trigger proof_reject_support_effect on public.integration_effects');
    await client.query('drop function public.proof_reject_support_effect()');
    const afterEffectFailure = await fixtureState(client);
    assert.deepEqual(afterEffectFailure, beforeEffectFailure, 'effect failure did not roll back message/ticket/event/order-request/quote state');

    const beforeNotificationFailure = await fixtureState(client);
    await client.query(`create function public.proof_reject_support_notification() returns trigger language plpgsql as $$ begin raise exception 'proof_notification_failure'; end $$`);
    await client.query(`create trigger proof_reject_support_notification before insert on public.notifications for each row execute function public.proof_reject_support_notification()`);
    await assert.rejects(
      client.query(`select public.append_support_message($1,null,'staff','Notification rollback proof',$3,'dashboard',false,$2,$2,$4,$5,'Rollback','general',false,2)`, [ids.company, ids.buyer, ids.order, ids.thread, append.result.ticket_id]),
      /proof_notification_failure/,
    );
    await client.query('drop trigger proof_reject_support_notification on public.notifications');
    await client.query('drop function public.proof_reject_support_notification()');
    const afterNotificationFailure = await fixtureState(client);
    assert.deepEqual(afterNotificationFailure, beforeNotificationFailure, 'notification failure did not roll back message/ticket/effect state');

    const staff = await one(client, `select public.append_support_message($1,null,'staff','Staff atomic notification proof',$3,'dashboard',false,$2,$2,$4,$5,'Staff reply','general',false,2) result`, [ids.company, ids.buyer, ids.order, ids.thread, append.result.ticket_id]);
    const notification = await one(client, `select support_message_id,company_id,user_id,body,link from public.notifications where support_message_id=$1`, [staff.result.id]);
    assert.equal(notification.company_id, ids.company);
    assert.equal(notification.user_id, ids.buyer);
    assert.equal(notification.body, 'Staff atomic notification proof');
    assert.equal(notification.link, `/dashboard.html?order=${ids.order}#messages`);

    const messages = await client.query(`select id, sender_role, external_alert_kind from public.messages order by created_at, id`);
    assert.ok(messages.rowCount >= 4, 'all four actual writers must reach public.messages');
    assert.equal(messages.rows.find((row) => row.id === append.result.id)?.external_alert_kind, 'message');
    assert.equal(messages.rows.find((row) => row.id === inbound.result.id)?.external_alert_kind, 'message');
    assert.equal(messages.rows.find((row) => row.id === order.result.message.id)?.external_alert_kind, 'support_request');
    assert.equal(messages.rows.find((row) => row.id === reopened.result.id)?.external_alert_kind, 'support_request');
    assert.equal(messages.rows.find((row) => row.id === ids.sameTimeReply)?.external_alert_kind, 'message');
    const effects = await client.query(`select effect.* from public.integration_effects effect join public.integration_events event on event.id=effect.event_id where event.provider='masest' and effect.effect_type='support_message_email'`);
    assert.equal(effects.rowCount, messages.rowCount - 1, 'one future support effect per message, excluding history');
    assert.ok(effects.rows.every((row) => (
      Object.keys(row.payload || {}).length === 1 && typeof row.payload?.message_id === 'string'
    )), 'support effect payload leaked data beyond message_id');
    assert.doesNotMatch(JSON.stringify(effects.rows.map((row) => row.payload)), /buyer@example|writer proof|atomic notification/i);

    // Duplicate inbound input returns the preexisting message/effect rather than a second event.
    await one(client, `select public.upsert_email_inbound_message($1,$2,'<inbound-041@example.test>','Inbound writer proof','buyer',null,$3,null,$4,$5) result`, [ids.company, ids.buyer, ids.order, ids.thread, append.result.ticket_id]);
    const duplicateCount = await one(client, `select count(*)::int as count from public.integration_events where provider_event_id='support-message/' || $1::text`, [inbound.result.id]);
    assert.equal(duplicateCount.count, 1, 'duplicate input split the canonical event');

    // Exact claim and generic batch claim race; at most one lease is acquired.
    const exactMessage = await one(client, `select public.append_support_message($1,$2,'buyer','Exact lease proof',$3,'dashboard',false,null,$2,$4,$5,'Exact lease','general',false,2) result`, [ids.company, ids.buyer, ids.order, ids.thread, append.result.ticket_id]);
    const target = exactMessage.result.id;
    peer = new Client(cluster.clientConfig);
    await peer.connect();
    await client.query('begin');
    const exact = await one(client, `select public.claim_support_message_email_effect($1,'proof-exact',60) result`, [target]);
    assert.equal(exact.result?.state, 'claimed', 'exact support claim must acquire its own effect');
    const batch = await peer.query(`select * from public.claim_integration_effects('proof-batch',25,60)`);
    assert.equal(batch.rows.filter((row) => row.payload?.message_id === target).length, 0, 'batch duplicated the exact lease');
    await client.query('commit');
    const claimed = exact.result.effect;

    // Inverse schedule: a generic worker holds the exact row lock while the
    // immediate claimant starts. After the generic commit, exact claim must
    // re-read and report that live lease rather than overwrite it.
    const lockedMessage = await one(client, `select public.append_support_message($1,$2,'buyer','Generic lease ownership proof',$3,'dashboard',false,null,$2,$4,$5,'Lease ownership','general',false,2) result`, [ids.company, ids.buyer, ids.order, ids.thread, append.result.ticket_id]);
    await client.query('begin');
    const genericLocked = await client.query(`select * from public.claim_integration_effects('proof-generic-lock',25,60)`);
    const genericTarget = genericLocked.rows.find((row) => row.payload?.message_id === lockedMessage.result.id);
    assert.ok(genericTarget, 'generic worker did not claim the inverse-race target');
    let exactSettled = false;
    const waitingExact = one(peer, `select public.claim_support_message_email_effect($1,'proof-exact-waiter',60) result`, [lockedMessage.result.id])
      .then((value) => { exactSettled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(exactSettled, false, 'exact claimant did not wait for the generic row lock');
    await client.query('commit');
    const observedGenericLease = await waitingExact;
    assert.equal(observedGenericLease.result?.state, 'processing', 'exact claimant stole the generic live lease');
    assert.equal(observedGenericLease.result?.effect?.lease_owner, 'proof-generic-lock');
    assert.equal(observedGenericLease.result?.effect?.attempt_count, genericTarget.attempt_count);

    const envelopeA = {
      request: {
        to: ['staff@example.test'], subject: 'Proof A', html: '<p>Proof A</p>', text: 'Proof A',
        replyTo: 'reply+proof@reply.masest.co', emailHeaders: {}, category: 'staff_alert',
        idempotencyKey: `support-message/${target}/buyer`,
      },
      references: null,
    };
    const envelopeB = {
      request: {
        to: ['changed@example.test'], subject: 'Proof B', html: '<p>Proof B</p>', text: 'Proof B',
        replyTo: 'reply+changed@reply.masest.co', emailHeaders: {}, category: 'staff_alert',
        idempotencyKey: `support-message/${target}/buyer`,
      },
      references: null,
    };
    const [frozen, raced] = await Promise.all([
      one(client, `select public.store_support_message_email_envelope($1,$2,$3::jsonb) envelope`, [claimed.id, claimed.lease_owner, JSON.stringify(envelopeA)]),
      one(peer, `select public.store_support_message_email_envelope($1,$2,$3::jsonb) envelope`, [claimed.id, claimed.lease_owner, JSON.stringify(envelopeB)]),
    ]);
    assert.deepEqual(raced.envelope, frozen.envelope, 'concurrent freeze did not return one winning envelope');
    const replay = await one(client, `select public.store_support_message_email_envelope($1,$2,null) envelope`, [claimed.id, claimed.lease_owner]);
    assert.deepEqual(replay.envelope, frozen.envelope, 'envelope changed across a provider retry');
    await peer.end();
    peer = null;
    await one(client, `select public.record_integration_effect_success($1,$2,jsonb_build_object('provider_message_id','proof')) ok`, [claimed.id, claimed.lease_owner]);
    await one(client, `select public.complete_integration_effect($1,$2) ok`, [claimed.id, claimed.lease_owner]);
    const terminal = await one(client, `select public.claim_support_message_email_effect($1,'proof-replay',60) result`, [target]);
    assert.equal(terminal.result?.state, 'completed', 'terminal effect was not reported as completed');

    const leaseCandidate = quoteClaims.rows.find((row) => row.effect_type === 'support_message_email');
    assert.ok(leaseCandidate, 'generic worker did not claim a support lease for reclaim proof');
    await client.query(`update public.integration_effects set lease_expires_at=now()-interval '1 second' where id=$1`, [leaseCandidate.id]);
    const reclaimed = await one(client, `select public.claim_support_message_email_effect($1,'proof-reclaim',60) result`, [leaseCandidate.payload.message_id]);
    assert.equal(reclaimed.result?.state, 'claimed', 'expired support lease was not reclaimed');
    const dead = await one(client, `select public.fail_integration_effect($1,'proof-reclaim','proof_terminal',1,1) status`, [leaseCandidate.id]);
    assert.equal(dead.status, 'dead', 'terminal failure did not reach the generic dead state');
    const deadState = await one(client, `select public.claim_support_message_email_effect($1,'proof-dead',60) result`, [leaseCandidate.payload.message_id]);
    assert.equal(deadState.result?.state, 'dead', 'exact claim did not expose the dead state');
    const replayed = await one(client, `select public.replay_integration_effect($1,'operator','proof replay') ok`, [leaseCandidate.id]);
    assert.equal(replayed.ok, true, 'generic dead-letter replay failed');
    const replayClaim = await one(client, `select public.claim_support_message_email_effect($1,'proof-replay',60) result`, [leaseCandidate.payload.message_id]);
    assert.equal(replayClaim.result?.state, 'claimed', 'explicit replay did not requeue exact effect');

    peer = new Client(cluster.clientConfig);
    await peer.connect();
    await peer.query('set role service_role');
    assert.equal((await one(peer, 'select count(*)::int count from public.support_message_email_envelopes')).count, 1);
    await peer.query('reset role');
    await peer.query('set role anon');
    await assert.rejects(peer.query('select * from public.support_message_email_envelopes'), /permission denied/i);
    await peer.query('reset role');
    await peer.query('set role authenticated');
    await assert.rejects(peer.query('select * from public.support_message_email_envelopes'), /permission denied/i);
    await peer.end();
    peer = null;
    await client.query('delete from public.messages where id=$1', [target]);
    const orphanedEnvelope = await one(client, `select count(*)::int count from public.support_message_email_envelopes where effect_id=$1`, [claimed.id]);
    assert.equal(orphanedEnvelope.count, 0, 'message deletion left readable envelope PII orphaned');
    console.log(JSON.stringify({
      ok: true,
      coverageMessages: messages.rowCount,
      coverageSupportEffects: effects.rowCount,
      rerun: true,
    }));
  } finally {
    if (peer) await peer.end().catch(() => {});
    if (client) await client.end().catch(() => {});
    await cluster.stop();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  if (error?.detail) console.error(`detail: ${error.detail}`);
  if (error?.where) console.error(`where: ${error.where}`);
  process.exitCode = 1;
});
