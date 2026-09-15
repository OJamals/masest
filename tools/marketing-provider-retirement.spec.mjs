import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const schema = read('supabase/schema-emailoctopus.sql');
const retire = read('supabase/migrate-retire-emailoctopus-2026-09-15.sql');
const rollback = read('supabase/rollback-retire-emailoctopus-2026-09-15.sql');
const prefs = read('supabase/migrate-ses-marketing-2026-09-03.sql')
  .match(/create or replace function public\.set_marketing_email_preferences\([\s\S]*?^\$\$;/m)?.[0];
const dir = mkdtempSync('/tmp/masest-provider-retirement-');
const dataDir = `${dir}/data`;
const binary = (name) => process.env.PG_BIN ? join(process.env.PG_BIN, name) : name;
const db = new pg.Client({ host: dir, port: 5432, database: 'postgres', user: process.env.USER });
let started = false;

test.before(async () => {
  assert.ok(prefs, 'canonical preference RPC must be present');
  execFileSync(binary('initdb'), ['-D', dataDir, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(binary('pg_ctl'), ['-D', dataDir, '-l', `${dir}/postgres.log`, '-o', `-k ${dir} -h '' -p 5432`, '-w', 'start'], { stdio: 'pipe' });
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
  if (started) execFileSync(binary('pg_ctl'), ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  rmSync(dir, { recursive: true, force: true });
});

test('retirement aborts atomically while companion contact data exists', async () => {
  await db.query("select set_marketing_email_preferences('[\"reader@example.com\"]', true, 'newsletter_signup')");
  assert.equal((await db.query('select count(*) from emailoctopus_contacts')).rows[0].count, '1');
  await assert.rejects(db.query(retire), /emailoctopus_retirement_requires_empty_tables/);
  await db.query('rollback');
  assert.equal((await db.query('select count(*) from emailoctopus_contacts')).rows[0].count, '1');
});

test('retirement removes companion schema but keeps account-erasure SES withdrawal', async () => {
  await db.query('truncate emailoctopus_contacts, emailoctopus_events, emailoctopus_connection, marketing_consent_events, email_suppressions, newsletter_recipients, auth.users, profiles');
  await db.query(retire);
  assert.equal((await db.query("select to_regclass('public.emailoctopus_contacts') as table_name")).rows[0].table_name, null);
  assert.equal((await db.query("select to_regprocedure('public.apply_emailoctopus_event(text,text,text)') as fn")).rows[0].fn, null);
  await db.query("select set_marketing_email_preferences('[\"reader@example.com\"]', true, 'newsletter_signup')");
  await db.query("insert into auth.users values ('00000000-0000-4000-8000-000000000003','reader@example.com')");
  await db.query('delete from auth.users');
  assert.equal((await db.query("select subscribed from newsletter_recipients where email='reader@example.com'")).rows[0].subscribed, false);
  assert.equal((await db.query("select count(*) from marketing_consent_events where source='account_erasure'")).rows[0].count, '1');
});

test('rollback restores historical schema and leaves one erasure trigger', async () => {
  await db.query(schema);
  await db.query(rollback);
  const triggers = (await db.query(`
    select tgname from pg_trigger
    where tgrelid = 'auth.users'::regclass and not tgisinternal and tgname like '%erasure_capture'
    order by tgname
  `)).rows.map((row) => row.tgname);
  assert.deepEqual(triggers, ['emailoctopus_account_erasure_capture']);
  assert.ok((await db.query("select to_regclass('public.emailoctopus_contacts') as table_name")).rows[0].table_name);
});
