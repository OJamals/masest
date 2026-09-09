import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const schema = readFileSync(new URL('supabase/schema-emailoctopus.sql', root), 'utf8');
const prefsFile = readFileSync(new URL('supabase/migrate-ses-marketing-2026-09-03.sql', root), 'utf8');
const prefs = prefsFile.match(/create or replace function public\.set_marketing_email_preferences\([\s\S]*?^\$\$;/m)?.[0];
const dir = mkdtempSync('/tmp/masest-emailoctopus-db-');
const dataDir = `${dir}/data`;
const db = new pg.Client({ host: dir, port: 5432, database: 'postgres', user: process.env.USER });
let started = false;
const worker = '00000000-0000-4000-8000-000000000002';
const list = '00000000-0000-4000-8000-000000000001';
const pgBinary = name => process.env.PG_BIN ? join(process.env.PG_BIN, name) : name;

test.before(async () => {
  assert.ok(prefs, 'canonical preference RPC must be present');
  execFileSync(pgBinary('initdb'), ['-D', dataDir, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(pgBinary('pg_ctl'), ['-D', dataDir, '-l', `${dir}/postgres.log`, '-o', `-k ${dir} -h '' -p 5432`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  await db.connect();
  await db.query(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create table public.profiles (id uuid primary key, marketing_email_enabled boolean);
    create table public.newsletter_recipients (email text primary key, name text, source text, tags text[], subscribed boolean);
    create table public.email_suppressions (email text, stream text default 'all', reason text, created_at timestamptz default now(), primary key(email,stream));
    create table public.marketing_consent_events (
      event_id text primary key, recipient text, enabled boolean, source text, occurred_at timestamptz,
      created_at timestamptz default now(), provider_sync_state text, provider_sync_available_at timestamptz,
      provider_sync_lease_token uuid, provider_sync_lease_expires_at timestamptz, provider_sync_error text
    );
    ${prefs}
  `);
  await db.query(schema);
});
test.after(async () => {
  await db.end().catch(() => {});
  if (started) execFileSync(pgBinary('pg_ctl'), ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(async () => {
  await db.query('truncate emailoctopus_contacts, emailoctopus_events, emailoctopus_connection, marketing_consent_events, email_suppressions, newsletter_recipients, auth.users, profiles');
});
const opt = (email, enabled, source = 'newsletter_signup') => db.query(
  'select set_marketing_email_preferences($1::jsonb,$2,$3)', [JSON.stringify([email]), enabled, source]);
const claim = async () => (await db.query('select * from claim_emailoctopus_contact($1)', [worker])).rows[0];
const finish = (c, success = true) => db.query('select finish_emailoctopus_contact($1,$2,$3,$4)', [c.recipient, worker, c.revision, success]);

test('explicit consent is queued atomically; default accounts and imported prospects are excluded', async () => {
  await opt('default@example.com', true, 'account_registration');
  await opt('import@example.com', true, 'admin_import');
  await opt('reader@example.com', true);
  const rows = (await db.query('select recipient from emailoctopus_contacts')).rows;
  assert.deepEqual(rows, [{ recipient: 'reader@example.com' }]);
  assert.equal((await claim()).enabled, true);
});

test('lease fencing preserves an opt-out that arrives while a subscribe request is in flight', async () => {
  await opt('reader@example.com', true);
  const first = await claim();
  assert.equal(await claim(), undefined);
  await opt('reader@example.com', false);
  await finish(first);
  const row = (await db.query('select state from emailoctopus_contacts')).rows[0];
  assert.equal(row.state, 'pending');
  assert.equal((await claim()).enabled, false);
});

test('provider opt-outs are idempotent and stay blocked after a local opt-in', async () => {
  await opt('reader@example.com', true);
  const apply = () => db.query("select apply_emailoctopus_event('event-1','reader@example.com','unsubscribed') as applied");
  assert.equal((await apply()).rows[0].applied, true);
  assert.equal((await apply()).rows[0].applied, false);
  assert.equal((await db.query('select subscribed from newsletter_recipients')).rows[0].subscribed, false);
  await opt('reader@example.com', true);
  assert.equal((await claim()).enabled, false);
});

test('bounces suppress both streams and unknown webhook recipients cannot enter the audience', async () => {
  await opt('reader@example.com', true);
  await db.query("select apply_emailoctopus_event('bounce-1','reader@example.com','bounced')");
  assert.ok((await db.query("select 1 from email_suppressions where stream='all'")).rowCount);
  await db.query("select apply_emailoctopus_event('unknown','outsider@example.com','unsubscribed')");
  assert.equal((await db.query("select 1 from newsletter_recipients where email='outsider@example.com'")).rowCount, 0);
});

test('hard suppression is rechecked when work is claimed', async () => {
  await opt('reader@example.com', true);
  await db.query("insert into email_suppressions(email,stream,reason) values ('reader@example.com','all','bounce')");
  assert.equal((await claim()).enabled, false);
});

test('account erasure persists a remote delete until completion, then removes the local copy', async () => {
  await opt('reader@example.com', true);
  await db.query("insert into auth.users values ('00000000-0000-4000-8000-000000000003','reader@example.com')");
  await db.query('delete from auth.users');
  const erased = await claim();
  assert.equal(erased.erase, true);
  assert.equal(erased.enabled, false);
  await finish(erased);
  assert.equal((await db.query('select 1 from emailoctopus_contacts')).rowCount, 0);
  assert.equal((await db.query('select subscribed from newsletter_recipients')).rows[0].subscribed, false);
  await db.query(schema);
  assert.equal((await db.query('select 1 from emailoctopus_contacts')).rowCount, 0, 'backfill cannot recreate an erased account contact');
});

test('list binding is immutable, migration is rerunnable, and browser roles cannot read or mutate provider state', async () => {
  await db.query('select bind_emailoctopus_list($1)', [list]);
  await assert.rejects(db.query('select bind_emailoctopus_list($1)', [worker]), /list_change_requires_review/);
  await opt('reader@example.com', true);
  await db.query(schema);
  assert.equal((await db.query('select 1 from emailoctopus_contacts')).rowCount, 1);
  await db.query('set role anon');
  await assert.rejects(db.query('select * from emailoctopus_contacts'), /permission denied/);
  await assert.rejects(db.query('select emailoctopus_status()'), /permission denied/);
  await db.query('reset role');
});
