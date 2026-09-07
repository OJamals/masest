#!/usr/bin/env node
/* Disposable PostgreSQL proof for Plan 042. Never connects to a remote database. */
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
  'migrate-support-tickets-2026-09-06.sql',
  'migrate-support-ticket-routing-2026-09-06.sql',
  'migrate-support-message-delivery-effects-2026-09-06.sql',
  'migrate-support-ticket-queue-2026-09-06.sql',
];
const ids = {
  company: '00000000-0000-4000-8000-000000000042',
  buyer: '10000000-0000-4000-8000-000000000042',
  staff: '11000000-0000-4000-8000-000000000042',
  ineligible: '12000000-0000-4000-8000-000000000042',
  readOnly: '13000000-0000-4000-8000-000000000042',
  autoBuyer: '14000000-0000-4000-8000-000000000042',
  thread: '20000000-0000-4000-8000-000000000042',
  companyThread: '21000000-0000-4000-8000-000000000042',
  autoThread: '22000000-0000-4000-8000-000000000042',
  orderA: '30000000-0000-4000-8000-000000000042',
  orderB: '31000000-0000-4000-8000-000000000042',
  orderC: '32000000-0000-4000-8000-000000000042',
  orderConcurrent: '33000000-0000-4000-8000-000000000042',
  pageHigh: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
  pageLow: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
  pageMicro: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
  placeholder: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  messageHigh: 'ffffffff-ffff-4fff-8fff-fffffffffff3',
  messageLow: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
  messageMicro: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
  otherCompany: '60000000-0000-4000-8000-000000000042',
  otherBuyer: '61000000-0000-4000-8000-000000000042',
  otherThread: '62000000-0000-4000-8000-000000000042',
  otherTicket: '63000000-0000-4000-8000-000000000042',
  otherOrder: '64000000-0000-4000-8000-000000000042',
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
  notify_admin_messages boolean default true, is_staff boolean not null default false,
  staff_role text
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
  title text not null, body text, link text, read boolean not null default false,
  created_at timestamptz not null default now()
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
  try {
    await client.query(await readFile(sqlPath(name), 'utf8'));
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
  assert.equal(result.rowCount, 1, `expected one row for ${text.slice(0, 90)}`);
  return result.rows[0];
}

async function append(client, {
  sender = 'buyer', body, orderId = null, recipientUserId = null,
  ticketId = null, subject = 'Queue proof', category = 'general',
  startTicket = false, expectedVersion = null,
  companyId = ids.company, userId = ids.buyer, threadId = ids.thread,
} = {}) {
  return one(client, `
    select public.append_support_message(
      $1,$2,$3,$4,$5,'dashboard',false,$6,$2,$7,$8,$9,$10,$11,2,$12
    ) result
  `, [
    companyId, sender === 'buyer' ? userId : null, sender, body, orderId,
    recipientUserId, threadId, ticketId, subject, category, startTicket, expectedVersion,
  ]);
}

async function listTickets(client, overrides = {}) {
  const options = {
    queue: 'all', assigneeMode: null, assigneeId: null, staffId: ids.staff,
    status: null, priority: null, category: null, search: null, companyId: null,
    orderId: null, threadIds: null, cursorAt: null, cursorId: null, limit: 50,
    ...overrides,
  };
  return (await one(client, `
    select public.list_support_tickets(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
    ) result
  `, [
    options.queue, options.assigneeMode, options.assigneeId, options.staffId,
    options.status, options.priority, options.category, options.search,
    options.companyId, options.orderId, options.threadIds, options.cursorAt,
    options.cursorId, options.limit,
  ])).result;
}

async function counts(client) {
  return one(client, `select
    (select count(*)::int from public.messages) messages,
    (select count(*)::int from public.support_tickets) tickets,
    (select count(*)::int from public.support_ticket_events) events,
    (select count(*)::int from public.integration_effects) effects,
    (select count(*)::int from public.notifications) notifications
  `);
}

async function main() {
  const cluster = await startOwnedPostgres({ prefix: 'masest-support-queue-' });
  let client;
  let waiterA;
  let waiterB;
  try {
    client = new Client(cluster.clientConfig);
    await client.connect();
    await client.query(fixture);
    await apply(client, migrations[0]);
    await applyRealFunction(client, 'schema-provider-inbox.sql', 'finish_integration_projection');
    for (const migration of migrations.slice(1, 3)) await apply(client, migration);

    await client.query(`insert into public.companies(id,name) values ($1,'Proof Co')`, [ids.company]);
    await client.query(`insert into public.profiles(id,company_id,full_name,email) values ($1,$2,'Buyer','buyer@example.test')`, [ids.buyer, ids.company]);
    await client.query(`insert into public.profiles(id,company_id,full_name,email) values ($1,$2,'Automatic Buyer','auto@example.test')`,
      [ids.autoBuyer, ids.company]);
    await client.query(`insert into public.profiles(id,company_id,full_name,email,is_staff,staff_role) values
      ($1,$3,'Sam Support','staff@example.test',true,'support'),
      ($2,$3,'Not staff','viewer@example.test',false,'support'),
      ($4,$3,'Read only','readonly@example.test',true,'read_only')`,
    [ids.staff, ids.ineligible, ids.company, ids.readOnly]);
    for (const [id, number] of [[ids.orderA, 'ORD-A'], [ids.orderB, 'ORD-B'], [ids.orderC, 'ORD-C'], [ids.orderConcurrent, 'ORD-RACE']]) {
      await client.query(`insert into public.orders(id,company_id,user_id,order_number,customer_email) values ($1,$2,$3,$4,'buyer@example.test')`, [id, ids.company, ids.buyer, number]);
    }
    await client.query(`insert into public.support_threads(id,participant_user_id,company_id) values ($1,$2,$3)`, [ids.thread, ids.buyer, ids.company]);
    await client.query(`insert into public.support_threads(id,participant_user_id,company_id) values ($1,$2,$3)`,
      [ids.autoThread, ids.autoBuyer, ids.company]);
    await client.query(`insert into public.support_threads(id,company_id) values ($1,$2)`, [ids.companyThread, ids.company]);
    const activation = await one(client, `select public.activate_support_ticket_routing(1) result`);
    assert.equal(activation.result.version, 2, 'fixture-only routing activation failed');
    await apply(client, migrations[3]);
    await apply(client, migrations[4]);
    await apply(client, migrations[4]);

    await client.query(`insert into public.companies(id,name) values ($1,'Other Proof Co')`, [ids.otherCompany]);
    await client.query(`insert into public.profiles(id,company_id,full_name,email) values ($1,$2,'Other Buyer','other@example.test')`,
      [ids.otherBuyer, ids.otherCompany]);
    await client.query(`insert into public.support_threads(id,participant_user_id,company_id) values ($1,$2,$3)`,
      [ids.otherThread, ids.otherBuyer, ids.otherCompany]);
    await client.query(`insert into public.orders(id,company_id,user_id,order_number,customer_email)
      values ($1,$2,$3,'ORD-FOREIGN','other@example.test')`, [ids.otherOrder, ids.otherCompany, ids.otherBuyer]);
    await client.query(`insert into public.support_tickets(id,thread_id,subject,last_message_at,last_message_body,last_sender_role)
      values ($1,$2,'Foreign tenant ticket','2097-01-01T00:00:00+00:00','Foreign message','buyer')`,
    [ids.otherTicket, ids.otherThread]);
    await client.query(`insert into public.messages(thread_id,ticket_id,company_id,user_id,sender_role,body,source,created_at)
      values ($1,$2,$3,$4,'buyer','Foreign message','proof','2097-01-01T00:00:00+00:00')`,
    [ids.otherThread, ids.otherTicket, ids.otherCompany, ids.otherBuyer]);

    // Grants are service-only; private selectors cannot be invoked through PostgREST roles.
    const grants = await one(client, `select
      has_function_privilege('service_role','public.list_support_tickets(text,text,uuid,uuid,text,text,text,text,uuid,uuid,uuid[],timestamptz,uuid,integer)','execute') service_list,
      has_function_privilege('anon','public.list_support_tickets(text,text,uuid,uuid,text,text,text,text,uuid,uuid,uuid[],timestamptz,uuid,integer)','execute') anon_list,
      has_function_privilege('authenticated','public.update_support_ticket(uuid,integer,uuid,text,text,text,uuid,boolean)','execute') authenticated_update,
      has_function_privilege('service_role','public.select_active_support_ticket_id(uuid,uuid)','execute') service_private
    `);
    assert.deepEqual(grants, {
      service_list: true, anon_list: false, authenticated_update: false, service_private: false,
    });

    const orderA = await append(client, { body: 'Order A starts', orderId: ids.orderA, subject: 'Order A' });
    const orderB = await append(client, { body: 'Order B starts', orderId: ids.orderB, subject: 'Order B' });
    assert.notEqual(orderA.result.ticket_id, orderB.result.ticket_id, 'distinct explicit orders shared one active episode');
    const beforeMismatches = await counts(client);
    await assert.rejects(append(client, {
      sender: 'staff', recipientUserId: ids.otherBuyer, body: 'Mismatched staff context',
      companyId: ids.otherCompany, threadId: null, ticketId: orderA.result.ticket_id,
    }), /support_participant_thread_mismatch/);
    assert.deepEqual(await counts(client), beforeMismatches,
      'staff ticket/thread/participant mismatch left durable state');
    await assert.rejects(append(client, {
      body: 'Cross-company order mismatch', orderId: ids.otherOrder,
    }), /support_order_thread_mismatch/);
    assert.deepEqual(await counts(client), beforeMismatches,
      'cross-company order mismatch changed messages, tickets, events, effects, or notifications');
    await client.query(`insert into public.messages(thread_id,ticket_id,company_id,user_id,sender_role,body,order_id,source)
      values ($1,$2,$3,$4,'buyer','Conflicting historical association',$5,'proof')`,
    [ids.thread, orderA.result.ticket_id, ids.company, ids.buyer, ids.orderB]);
    assert.equal((await one(client, `select public.select_active_support_ticket_id($1,$2) id`, [ids.thread, ids.orderB])).id,
      orderB.result.ticket_id, 'conflicting non-null primary order was selected through message history');

    const nullPrimary = await append(client, { body: 'No order starts', subject: 'General issue', startTicket: true });
    await append(client, { body: 'Associate order C', orderId: ids.orderC, ticketId: nullPrimary.result.ticket_id });
    assert.equal((await one(client, `select public.select_active_support_ticket_id($1,$2) id`, [ids.thread, ids.orderC])).id,
      nullPrimary.result.ticket_id, 'null-primary historical order association was not retained');

    // Both waiters begin with no order-specific ticket and block on the held thread lock.
    waiterA = new Client(cluster.clientConfig);
    waiterB = new Client(cluster.clientConfig);
    await Promise.all([waiterA.connect(), waiterB.connect()]);
    await client.query('begin');
    await client.query(`select 1 from public.support_threads where id=$1 for update`, [ids.thread]);
    let raceSettled = 0;
    const raced = [waiterA, waiterB].map((connection, index) => append(connection, {
      body: `Concurrent order message ${index + 1}`, orderId: ids.orderConcurrent, subject: 'Concurrent order',
    }).then((value) => { raceSettled += 1; return value; }));
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(raceSettled, 0, 'automatic append bypassed the canonical thread lock');
    await client.query('commit');
    const [raceA, raceB] = await Promise.all(raced);
    assert.equal(raceA.result.ticket_id, raceB.result.ticket_id, 'contending automatic sends created duplicate order tickets');
    assert.equal((await one(client, `select count(*)::int count from public.support_tickets where primary_order_id=$1`, [ids.orderConcurrent])).count, 1);
    await Promise.all([waiterA.end(), waiterB.end()]);
    waiterA = null;
    waiterB = null;

    // With no order hint, contending automatic sends reuse one active ticket.
    waiterA = new Client(cluster.clientConfig);
    waiterB = new Client(cluster.clientConfig);
    await Promise.all([waiterA.connect(), waiterB.connect()]);
    await client.query('begin');
    await client.query(`select 1 from public.support_threads where id=$1 for update`, [ids.autoThread]);
    let defaultRaceSettled = 0;
    const defaultRace = [waiterA, waiterB].map((connection, index) => append(connection, {
      body: `Concurrent default message ${index + 1}`,
      userId: ids.autoBuyer,
      threadId: ids.autoThread,
    }).then((value) => { defaultRaceSettled += 1; return value; }));
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(defaultRaceSettled, 0, 'automatic no-order append bypassed the canonical thread lock');
    await client.query('commit');
    const [defaultA, defaultB] = await Promise.all(defaultRace);
    assert.equal(defaultA.result.ticket_id, defaultB.result.ticket_id,
      'contending automatic no-order sends created duplicate tickets');
    assert.equal((await one(client, `select count(*)::int count from public.support_tickets where thread_id=$1`,
      [ids.autoThread])).count, 1, 'automatic no-order reuse persisted more than one ticket');
    await Promise.all([waiterA.end(), waiterB.end()]);
    waiterA = null;
    waiterB = null;

    const explicitSecond = await append(client, {
      body: 'Explicit second ticket in one context', userId: ids.autoBuyer,
      threadId: ids.autoThread, startTicket: true,
    });
    assert.notEqual(explicitSecond.result.ticket_id, defaultA.result.ticket_id,
      'explicit second ticket reused the existing context ticket');
    const secondBeforeResolve = await one(client,
      `select status,version,resolved_at from public.support_tickets where id=$1`, [explicitSecond.result.ticket_id]);
    const firstAutoTicket = await one(client,
      `select version from public.support_tickets where id=$1`, [defaultA.result.ticket_id]);
    await one(client, `select public.update_support_ticket($1,$2,$3,'resolved',null,null,null,false) result`,
      [defaultA.result.ticket_id, firstAutoTicket.version, ids.staff]);
    assert.deepEqual(await one(client,
      `select status,version,resolved_at from public.support_tickets where id=$1`, [explicitSecond.result.ticket_id]),
    secondBeforeResolve, 'resolving ticket A changed ticket B in the same context');

    // Queue pagination is stable at equal timestamps and preserves microseconds.
    await client.query(`insert into public.support_tickets(id,thread_id,subject,last_message_at,last_message_body,last_sender_role) values
      ($1,$4,'Literal 50%_off','2099-01-01T00:00:00.123456+00:00','literal search','buyer'),
      ($2,$4,'Equal low','2099-01-01T00:00:00.123456+00:00','equal low','buyer'),
      ($3,$4,'Micro newer','2099-01-01T00:00:00.123457+00:00','micro newer','buyer'),
      ($5,$4,'Null message placeholder',null,null,null)`,
    [ids.pageHigh, ids.pageLow, ids.pageMicro, ids.companyThread, ids.placeholder]);
    const first = await listTickets(client, { threadIds: [ids.companyThread], limit: 2 });
    assert.deepEqual(first.tickets.map((ticket) => ticket.id), [ids.pageMicro, ids.pageHigh]);
    assert.equal(first.has_more, true);
    assert.match(first.next_cursor.timestamp, /\.123456(?:Z|[+-]\d{2}:\d{2})$/);
    const second = await listTickets(client, {
      threadIds: [ids.companyThread], limit: 2,
      cursorAt: first.next_cursor.timestamp, cursorId: first.next_cursor.id,
    });
    assert.deepEqual(second.tickets.map((ticket) => ticket.id), [ids.pageLow]);
    assert.equal(second.has_more, false);
    assert.equal(first.summary.open, 3, 'summary was derived from the page or included placeholder tickets');
    assert.equal(second.summary.open, first.summary.open, 'cursor changed page-independent summary counts');
    assert.equal((await listTickets(client, { threadIds: [], limit: 50 })).tickets.length, 0, 'empty buyer scope was not fail-closed');
    const literalSearch = await listTickets(client, { threadIds: [ids.companyThread], search: '50\\%\\_off' });
    assert.deepEqual(literalSearch.tickets.map((ticket) => ticket.id), [ids.pageHigh]);
    assert.equal(literalSearch.summary.open, 1, 'common literal search filter did not scope summary counts');

    await client.query(`update public.support_tickets set assigned_to=$1 where id in ($2,$3)`,
      [ids.staff, ids.pageHigh, ids.pageLow]);
    await client.query(`update public.support_tickets set status='waiting_on_customer',last_sender_role='staff' where id=$1`,
      [ids.pageLow]);
    await client.query(`update public.support_tickets set status='resolved',resolved_at=now() where id=$1`,
      [ids.pageMicro]);
    const resolvedQueue = await listTickets(client, {
      threadIds: [ids.companyThread], queue: 'resolved', assigneeMode: 'unassigned', limit: 1,
    });
    assert.deepEqual(resolvedQueue.tickets.map((ticket) => ticket.id), [ids.pageMicro]);
    assert.deepEqual(resolvedQueue.summary, {
      open: 2, unanswered: 1, needs_reply: 1, mine: 2, unassigned: 0, waiting: 1, resolved: 1,
    }, 'summary incorrectly inherited selected queue, assignment, or page');
    const companyOnly = await listTickets(client, { companyId: ids.company, limit: 100 });
    assert.equal(companyOnly.tickets.some((ticket) => ticket.id === ids.otherTicket), false, 'Company filter crossed tenant scope');
    const unrestricted = await listTickets(client, { limit: 100 });
    assert.equal(unrestricted.tickets.some((ticket) => ticket.id === ids.otherTicket), true, 'admin null scope was not unrestricted');

    // The transcript predicate matches the HTTP composite cursor exactly.
    await client.query(`insert into public.messages(id,thread_id,ticket_id,company_id,user_id,sender_role,body,source,created_at) values
      ($1,$4,$5,$6,$7,'buyer','Equal message high','proof','2098-01-01T00:00:00.123456+00:00'),
      ($2,$4,$5,$6,$7,'buyer','Equal message low','proof','2098-01-01T00:00:00.123456+00:00'),
      ($3,$4,$5,$6,$7,'buyer','Micro message newer','proof','2098-01-01T00:00:00.123457+00:00')`,
    [ids.messageHigh, ids.messageLow, ids.messageMicro, ids.companyThread, ids.pageLow, ids.company, ids.buyer]);
    const messageFirst = await client.query(`select id,created_at::text created_at from public.messages
      where ticket_id=$1 order by created_at desc,id desc limit 2`, [ids.pageLow]);
    assert.deepEqual(messageFirst.rows.map((message) => message.id), [ids.messageMicro, ids.messageHigh]);
    assert.match(messageFirst.rows[1].created_at, /\.123456(?:Z|[+-]\d{2}(?::\d{2})?)$/);
    const messageSecond = await client.query(`select id from public.messages where ticket_id=$1
      and (created_at < $2::timestamptz or (created_at = $2::timestamptz and id < $3::uuid))
      order by created_at desc,id desc limit 2`,
    [ids.pageLow, messageFirst.rows[1].created_at, messageFirst.rows[1].id]);
    assert.deepEqual(messageSecond.rows.map((message) => message.id), [ids.messageLow]);

    // Metadata changes share one CAS and validate durable profile-backed assignees.
    let version = Number(orderA.result.ticket.version);
    const assigned = (await one(client, `select public.update_support_ticket($1,$2,$3,null,'high','billing',$4,true) result`,
      [orderA.result.ticket_id, version, ids.staff, ids.staff])).result;
    assert.equal(assigned.assigned_to, ids.staff);
    assert.equal(assigned.category, 'billing');
    assert.equal(assigned.priority, 'high');
    version = Number(assigned.version);
    const beforeStaleUpdate = await one(client, `select priority,category,assigned_to,version from public.support_tickets where id=$1`,
      [orderA.result.ticket_id]);
    const beforeStaleUpdateEvents = (await one(client, `select count(*)::int count from public.support_ticket_events where ticket_id=$1`,
      [orderA.result.ticket_id])).count;
    await assert.rejects(
      client.query(`select public.update_support_ticket($1,$2,$3,null,'urgent','technical',null,false)`,
        [orderA.result.ticket_id, version - 1, ids.staff]),
      /ticket_version_conflict/,
    );
    assert.deepEqual(
      await one(client, `select priority,category,assigned_to,version from public.support_tickets where id=$1`,
        [orderA.result.ticket_id]),
      beforeStaleUpdate,
      'stale metadata CAS changed ticket fields or version',
    );
    assert.equal((await one(client, `select count(*)::int count from public.support_ticket_events where ticket_id=$1`,
      [orderA.result.ticket_id])).count, beforeStaleUpdateEvents, 'stale metadata CAS inserted private events');
    await assert.rejects(
      client.query(`select public.update_support_ticket($1,$2,$3,null,null,null,$4,true)`,
        [orderA.result.ticket_id, version, ids.staff, ids.ineligible]),
      /support_ticket_assignee_ineligible/,
    );
    await assert.rejects(
      client.query(`select public.update_support_ticket($1,$2,$3,null,null,null,$4,true)`,
        [orderA.result.ticket_id, version, ids.staff, ids.readOnly]),
      /support_ticket_assignee_ineligible/,
    );
    const unassigned = (await one(client, `select public.update_support_ticket($1,$2,$3,null,null,null,null,true) result`,
      [orderA.result.ticket_id, version, ids.staff])).result;
    assert.equal(unassigned.assigned_to, null);
    version = Number(unassigned.version);

    const staffReply = await append(client, {
      sender: 'staff', recipientUserId: ids.buyer, body: 'Versioned staff reply', orderId: ids.orderA,
      ticketId: orderA.result.ticket_id, expectedVersion: version,
    });
    assert.equal(Number(staffReply.result.ticket.version), version + 1);
    await assert.rejects(append(client, {
      sender: 'staff', recipientUserId: ids.buyer, body: 'Stale staff reply', orderId: ids.orderA,
      ticketId: orderA.result.ticket_id, expectedVersion: version,
    }), /ticket_version_conflict/);

    const firstResponse = await one(client,
      `select first_response_at,version from public.support_tickets where id=$1`, [orderA.result.ticket_id]);
    assert.ok(firstResponse.first_response_at, 'first staff reply did not set first_response_at');
    await client.query('select pg_sleep(0.01)');
    const laterStaffReply = await append(client, {
      sender: 'staff', recipientUserId: ids.buyer, body: 'Later staff reply', orderId: ids.orderA,
      ticketId: orderA.result.ticket_id, expectedVersion: Number(firstResponse.version),
    });
    assert.ok(new Date(laterStaffReply.result.created_at) > new Date(firstResponse.first_response_at),
      'second staff reply did not have a demonstrably later timestamp');
    assert.equal((await one(client, `select first_response_at from public.support_tickets where id=$1`,
      [orderA.result.ticket_id])).first_response_at.toISOString(), firstResponse.first_response_at.toISOString(),
    'second staff reply overwrote first_response_at');

    version = Number(laterStaffReply.result.ticket.version);
    waiterA = new Client(cluster.clientConfig);
    waiterB = new Client(cluster.clientConfig);
    await Promise.all([waiterA.connect(), waiterB.connect()]);
    await client.query('begin');
    await client.query(`select 1 from public.support_threads where id=$1 for update`, [ids.thread]);
    let metadataSettled = false;
    let replySettled = false;
    const contendingMetadata = waiterA.query(
      `select public.update_support_ticket($1,$2,$3,null,'urgent',null,null,false) result`,
      [orderA.result.ticket_id, version, ids.staff],
    ).then((value) => { metadataSettled = true; return value.rows[0]; });
    const contendingReply = append(waiterB, {
      sender: 'staff', recipientUserId: ids.buyer, body: 'Contending lock-order reply', orderId: ids.orderA,
      ticketId: orderA.result.ticket_id, expectedVersion: version,
    }).then((value) => { replySettled = true; return value; });
    const contentionResult = Promise.allSettled([contendingMetadata, contendingReply]);
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(metadataSettled, false, 'metadata mutation bypassed the canonical thread lock');
    assert.equal(replySettled, false, 'staff reply bypassed the canonical thread lock');
    await client.query('commit');
    const contention = await contentionResult;
    assert.equal(contention.filter(({ status }) => status === 'fulfilled').length, 1,
      'same-version metadata and reply contention did not serialize to one winner');
    const contentionFailure = contention.find(({ status }) => status === 'rejected');
    assert.match(String(contentionFailure?.reason?.message || ''), /ticket_version_conflict/);
    version = Number((await one(client, `select version from public.support_tickets where id=$1`, [orderA.result.ticket_id])).version);
    assert.equal(version, Number(laterStaffReply.result.ticket.version) + 1, 'serialized metadata/reply contention bumped version more than once');
    await Promise.all([waiterA.end(), waiterB.end()]);
    waiterA = null;
    waiterB = null;
    const resolved = (await one(client, `select public.update_support_ticket($1,$2,$3,'resolved',null,null,null,false) result`,
      [orderA.result.ticket_id, version, ids.staff])).result;
    const beforeResolvedReply = await counts(client);
    await assert.rejects(append(client, {
      sender: 'staff', recipientUserId: ids.buyer, body: 'Must explicitly reopen', orderId: ids.orderA,
      ticketId: orderA.result.ticket_id, expectedVersion: Number(resolved.version),
    }), /support_ticket_reply_resolved/);
    assert.deepEqual(await counts(client), beforeResolvedReply, 'rejected resolved reply left partial effects');

    const reopened = (await one(client, `select public.update_support_ticket($1,$2,$3,'open',null,null,null,false) result`,
      [orderA.result.ticket_id, Number(resolved.version), ids.staff])).result;
    await append(client, {
      sender: 'staff', recipientUserId: ids.buyer, body: 'Reply after explicit reopen', orderId: ids.orderA,
      ticketId: orderA.result.ticket_id, expectedVersion: Number(reopened.version),
    });

    // Buyer replies move waiting/resolved tickets to open with exact prior-state events.
    let ticket = (await one(client, `select * from public.support_tickets where id=$1`, [orderB.result.ticket_id]));
    ticket = (await one(client, `select public.update_support_ticket($1,$2,$3,'waiting_on_customer',null,null,null,false) result`,
      [ticket.id, ticket.version, ids.staff])).result;
    const waitingReply = await append(client, { body: 'Customer answered waiting ticket', orderId: ids.orderB, ticketId: ticket.id });
    assert.equal(waitingReply.result.ticket.status, 'open');
    const waitingEvent = await one(client, `select from_value,to_value from public.support_ticket_events
      where ticket_id=$1 and idempotency_key='ticket-customer-replied/' || $2::text`, [ticket.id, waitingReply.result.id]);
    assert.deepEqual(waitingEvent, { from_value: 'waiting_on_customer', to_value: 'open' });

    ticket = (await one(client, `select public.update_support_ticket($1,$2,$3,'resolved',null,null,null,false) result`,
      [ticket.id, Number(waitingReply.result.ticket.version), ids.staff])).result;
    const resolvedBuyer = await append(client, { body: 'Customer reopens resolved ticket', orderId: ids.orderB, ticketId: ticket.id });
    assert.equal(resolvedBuyer.result.ticket.status, 'open');
    assert.equal((await one(client, `select external_alert_kind from public.messages where id=$1`, [resolvedBuyer.result.id])).external_alert_kind,
      'support_request');

    ticket = (await one(client, `select public.update_support_ticket($1,$2,$3,'waiting_on_customer',null,null,null,false) result`,
      [ticket.id, Number(resolvedBuyer.result.ticket.version), ids.staff])).result;
    const inbound = (await one(client, `select public.upsert_email_inbound_message(
      $1,$2,'<queue-042@example.test>','Inbound waiting reply','buyer',null,$3,null,$4,$5
    ) result`, [ids.company, ids.buyer, ids.orderB, ids.thread, ticket.id])).result;
    assert.equal(inbound.ticket.status, 'open');
    assert.equal(inbound.alert_kind, 'message', 'waiting inbound reply was misclassified as a reopened support request');
    const inboundEvent = await one(client, `select from_value,to_value from public.support_ticket_events
      where ticket_id=$1 and idempotency_key='ticket-customer-replied/' || $2::text`, [ticket.id, inbound.id]);
    assert.deepEqual(inboundEvent, { from_value: 'waiting_on_customer', to_value: 'open' });
    const inboundVersion = Number(inbound.ticket.version);
    const duplicate = (await one(client, `select public.upsert_email_inbound_message(
      $1,$2,'<queue-042@example.test>','Inbound waiting reply','buyer',null,$3,null,$4,$5
    ) result`, [ids.company, ids.buyer, ids.orderB, ids.thread, ticket.id])).result;
    assert.equal(duplicate.inserted, false);
    assert.equal(Number(duplicate.ticket.version), inboundVersion, 'duplicate inbound bumped ticket state');

    // 041 durability remains inside the append transaction for effects and notifications.
    const beforeEffectFailure = await counts(client);
    await client.query(`create function public.proof_reject_support_effect() returns trigger language plpgsql as $$
      begin raise exception 'proof_effect_failure'; end $$`);
    await client.query(`create trigger proof_reject_support_effect before insert on public.integration_effects
      for each row when (new.effect_type='support_message_email') execute function public.proof_reject_support_effect()`);
    await assert.rejects(append(client, {
      body: 'Effect rollback proof', orderId: ids.orderB, ticketId: ticket.id,
    }), /proof_effect_failure/);
    await client.query('drop trigger proof_reject_support_effect on public.integration_effects');
    await client.query('drop function public.proof_reject_support_effect()');
    assert.deepEqual(await counts(client), beforeEffectFailure, 'effect failure did not roll back ticket/message state');

    const current = await one(client, `select version from public.support_tickets where id=$1`, [ticket.id]);
    const beforeNotificationFailure = await counts(client);
    await client.query(`create function public.proof_reject_support_notification() returns trigger language plpgsql as $$
      begin raise exception 'proof_notification_failure'; end $$`);
    await client.query(`create trigger proof_reject_support_notification before insert on public.notifications
      for each row execute function public.proof_reject_support_notification()`);
    await assert.rejects(append(client, {
      sender: 'staff', recipientUserId: ids.buyer, body: 'Notification rollback proof', orderId: ids.orderB,
      ticketId: ticket.id, expectedVersion: current.version,
    }), /proof_notification_failure/);
    await client.query('drop trigger proof_reject_support_notification on public.notifications');
    await client.query('drop function public.proof_reject_support_notification()');
    assert.deepEqual(await counts(client), beforeNotificationFailure, 'notification failure did not roll back ticket/message/effect state');

    const timestampGrammar = await one(client, `select
      pg_input_is_valid('2026-09-06T14:00:00.123456+14:00','timestamptz') canonical,
      pg_input_is_valid('0000-01-01T00:00:00+00:00','timestamptz') year_zero,
      pg_input_is_valid('2026-09-06T14:00:00+16:00','timestamptz') offset_sixteen,
      pg_input_is_valid('2026-09-06T14:00:00+23:59','timestamptz') offset_twenty_three
    `);
    assert.equal(timestampGrammar.canonical, true);
    assert.equal(timestampGrammar.year_zero, false);
    assert.equal(timestampGrammar.offset_sixteen, false);
    assert.equal(timestampGrammar.offset_twenty_three, false);

    assert.equal((await one(client, `select count(*)::int count from public.messages where ticket_id is null`)).count, 0,
      'cutover left messages without canonical ticket identities');

    const eventId = (await one(client, `select id from public.support_ticket_events order by created_at,id limit 1`)).id;
    const privateReader = new Client(cluster.clientConfig);
    try {
      await privateReader.connect();
      for (const role of ['anon', 'authenticated']) {
        await privateReader.query(`set role ${role}`);
        await assert.rejects(privateReader.query('select * from public.support_tickets'), /permission denied/i);
        await assert.rejects(privateReader.query('select * from public.support_ticket_events'), /permission denied/i);
        await privateReader.query('reset role');
      }
      await privateReader.query('set role service_role');
      await assert.rejects(privateReader.query('update public.support_ticket_events set detail=detail where id=$1', [eventId]),
        /permission denied/i);
      await assert.rejects(privateReader.query('delete from public.support_ticket_events where id=$1', [eventId]),
        /permission denied/i);
      await privateReader.query('reset role');
    } finally {
      await privateReader.end().catch(() => {});
    }

    const populatedCounts = await counts(client);
    const populatedTickets = await one(client, `select coalesce(jsonb_agg(to_jsonb(ticket) order by ticket.id),'[]'::jsonb) snapshot
      from public.support_tickets ticket`);
    await apply(client, migrations[4]);
    assert.deepEqual(await counts(client), populatedCounts, 'populated migration rerun changed durable row counts');
    assert.deepEqual(await one(client, `select coalesce(jsonb_agg(to_jsonb(ticket) order by ticket.id),'[]'::jsonb) snapshot
      from public.support_tickets ticket`), populatedTickets, 'populated migration rerun changed ticket fields or versions');
    const rpcSignatures = await client.query(`select proname,pronargs from pg_proc
      where pronamespace='public'::regnamespace
        and proname in ('append_support_message','update_support_ticket','list_support_tickets')
      order by proname,pronargs`);
    assert.deepEqual(rpcSignatures.rows, [
      { proname: 'append_support_message', pronargs: 16 },
      { proname: 'list_support_tickets', pronargs: 14 },
      { proname: 'update_support_ticket', pronargs: 8 },
    ], 'obsolete or ambiguous public RPC overload remains');

    console.log(JSON.stringify({
      ok: true,
      migrationRerun: true,
      concurrentTicketId: raceA.result.ticket_id,
      pagination: [ids.pageMicro, ids.pageHigh, ids.pageLow],
      timestampGrammar,
    }));
  } finally {
    if (client) await client.query('rollback').catch(() => {});
    if (waiterA) await waiterA.end().catch(() => {});
    if (waiterB) await waiterB.end().catch(() => {});
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
