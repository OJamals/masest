#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { buildProspectImportPlan } from './lib/prospect-import-plan.mjs';

const { Client } = pg;
const SHA256_RE = /^[0-9a-f]{64}$/;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected_argument:${token}`);
    const key = token.slice(2).replaceAll('-', '_');
    if (['apply', 'migrate', 'verify_live', 'help'].includes(key)) args[key] = true;
    else {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing_value:${token}`);
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return [
    'Dry run:',
    '  node tools/import-prospects.mjs --source <contact_data.json> --workbook <source.xlsx>',
    'Apply:',
    '  node tools/import-prospects.mjs --source <json> --workbook <xlsx> --apply --migrate',
    '    --expected-project-ref <ref> --expected-workbook-sha <sha256> --actor <staff-email>',
    'Live aggregate verification:',
    '  node tools/import-prospects.mjs --source <json> --workbook <xlsx> --verify-live',
    '    --expected-project-ref <ref> --expected-workbook-sha <sha256>',
  ].join('\n');
}

async function parseEnvFile(path) {
  const values = {};
  const input = await readFile(path, 'utf8');
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function projectRefFromUrl(value) {
  try {
    const host = new URL(value).hostname;
    return host.endsWith('.supabase.co') ? host.split('.')[0] : null;
  } catch {
    return null;
  }
}

function verifyTarget(environment, expectedProjectRef) {
  const expected = String(expectedProjectRef || '').trim();
  if (!expected) throw new Error('expected_project_ref_required');
  const actual = projectRefFromUrl(environment.SUPABASE_URL);
  if (!actual || actual !== expected) throw new Error('supabase_project_ref_mismatch');
  if (!environment.SUPABASE_DB_URL || !environment.SUPABASE_DB_URL.includes(expected)) {
    throw new Error('supabase_database_target_mismatch');
  }
}

function organizationRows(plan) {
  return plan.organizations.map((row) => ({
    identity_key: row.identityKey,
    name: row.name,
    normalized_name: row.normalizedName,
    segment: row.segment,
    address: row.address,
    city: row.city,
    state: row.state,
    postal_code: row.postalCode,
    location: row.location,
    general_email: row.generalEmail,
    phone: row.phone,
    website: row.website,
    linkedin: row.linkedin,
    status: row.status,
    priority: row.priority,
    marketing_consent: row.marketingConsent,
    outreach_status: row.outreachStatus,
    retention_review_at: row.retentionReviewAt,
  }));
}

function contactRows(plan) {
  return plan.contacts.map((row) => ({
    organization_identity_key: row.organizationIdentityKey,
    identity_key: row.identityKey,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    linkedin: row.linkedin,
    marketing_consent: row.marketingConsent,
    outreach_status: row.outreachStatus,
    needs_verification: row.needsVerification,
    retention_review_at: row.retentionReviewAt,
  }));
}

function sourceRows(plan) {
  return plan.sourceRecords.map((row) => ({
    source_record_id: row.sourceRecordId,
    record_type: row.recordType,
    organization_identity_key: row.organizationIdentityKey,
    contact_identity_key: row.contactIdentityKey,
    source_ids: row.sourceIds,
  }));
}

async function assertSchemaReady(client) {
  const { rows } = await client.query(`
    select
      to_regclass('public.prospect_import_batches') is not null as batches,
      to_regclass('public.prospect_organizations') is not null as organizations,
      to_regclass('public.prospect_contacts') is not null as contacts,
      to_regclass('public.prospect_source_records') is not null as sources
  `);
  if (!rows[0] || Object.values(rows[0]).some((value) => value !== true)) {
    throw new Error('prospect_schema_not_ready');
  }
}

async function upsertBatch(client, plan, actor) {
  const inserted = await client.query(`
    insert into public.prospect_import_batches (
      source_sha256, manifest_sha256, source_generated_on, source_record_count,
      organization_count, contact_count, imported_by
    ) values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (source_sha256) do nothing
    returning id
  `, [
    plan.batch.sourceSha256,
    plan.batch.manifestSha256,
    plan.batch.sourceGeneratedOn,
    plan.batch.sourceRecordCount,
    plan.batch.organizationCount,
    plan.batch.contactCount,
    actor,
  ]);
  if (inserted.rows[0]?.id) return inserted.rows[0].id;
  const existing = await client.query(`
    select id, manifest_sha256, source_record_count, organization_count, contact_count
    from public.prospect_import_batches
    where source_sha256 = $1
  `, [plan.batch.sourceSha256]);
  const batch = existing.rows[0];
  if (!batch
    || batch.manifest_sha256 !== plan.batch.manifestSha256
    || Number(batch.source_record_count) !== plan.batch.sourceRecordCount
    || Number(batch.organization_count) !== plan.batch.organizationCount
    || Number(batch.contact_count) !== plan.batch.contactCount) {
    throw new Error('prospect_batch_identity_collision');
  }
  return batch.id;
}

async function upsertOrganizations(client, plan, batchId) {
  await client.query(`
    insert into public.prospect_organizations (
      identity_key, name, normalized_name, segment, address, city, state, postal_code,
      location, general_email, phone, website, linkedin, status, priority,
      marketing_consent, outreach_status, first_import_batch_id, last_import_batch_id,
      retention_review_at
    )
    select
      incoming.identity_key, incoming.name, incoming.normalized_name, incoming.segment,
      incoming.address, incoming.city, incoming.state, incoming.postal_code,
      incoming.location, incoming.general_email, incoming.phone, incoming.website,
      incoming.linkedin, incoming.status, incoming.priority, incoming.marketing_consent,
      incoming.outreach_status, $2::uuid, $2::uuid, incoming.retention_review_at
    from jsonb_to_recordset($1::jsonb) as incoming(
      identity_key text, name text, normalized_name text, segment text, address text,
      city text, state text, postal_code text, location text, general_email text,
      phone text, website text, linkedin text, status text, priority text,
      marketing_consent text, outreach_status text, retention_review_at date
    )
    on conflict (identity_key) do update set
      name = excluded.name,
      normalized_name = excluded.normalized_name,
      segment = coalesce(excluded.segment, prospect_organizations.segment),
      address = coalesce(excluded.address, prospect_organizations.address),
      city = coalesce(excluded.city, prospect_organizations.city),
      state = coalesce(excluded.state, prospect_organizations.state),
      postal_code = coalesce(excluded.postal_code, prospect_organizations.postal_code),
      location = coalesce(excluded.location, prospect_organizations.location),
      general_email = coalesce(excluded.general_email, prospect_organizations.general_email),
      phone = coalesce(excluded.phone, prospect_organizations.phone),
      website = coalesce(excluded.website, prospect_organizations.website),
      linkedin = coalesce(excluded.linkedin, prospect_organizations.linkedin),
      last_import_batch_id = excluded.last_import_batch_id,
      retention_review_at = greatest(prospect_organizations.retention_review_at, excluded.retention_review_at),
      updated_at = now()
  `, [JSON.stringify(organizationRows(plan)), batchId]);
}

async function upsertContacts(client, plan, batchId) {
  await client.query(`
    insert into public.prospect_contacts (
      organization_id, identity_key, name, title, email, phone, linkedin,
      marketing_consent, outreach_status, needs_verification, first_import_batch_id,
      last_import_batch_id, retention_review_at
    )
    select
      organization.id, incoming.identity_key, incoming.name, incoming.title,
      incoming.email, incoming.phone, incoming.linkedin, incoming.marketing_consent,
      incoming.outreach_status, incoming.needs_verification, $2::uuid, $2::uuid,
      incoming.retention_review_at
    from jsonb_to_recordset($1::jsonb) as incoming(
      organization_identity_key text, identity_key text, name text, title text,
      email text, phone text, linkedin text, marketing_consent text,
      outreach_status text, needs_verification boolean, retention_review_at date
    )
    join public.prospect_organizations organization
      on organization.identity_key = incoming.organization_identity_key
    on conflict (identity_key) do update set
      organization_id = excluded.organization_id,
      name = excluded.name,
      title = coalesce(excluded.title, prospect_contacts.title),
      email = coalesce(excluded.email, prospect_contacts.email),
      phone = coalesce(excluded.phone, prospect_contacts.phone),
      linkedin = coalesce(excluded.linkedin, prospect_contacts.linkedin),
      needs_verification = prospect_contacts.needs_verification or excluded.needs_verification,
      last_import_batch_id = excluded.last_import_batch_id,
      retention_review_at = greatest(prospect_contacts.retention_review_at, excluded.retention_review_at),
      updated_at = now()
  `, [JSON.stringify(contactRows(plan)), batchId]);
}

async function upsertSources(client, plan, batchId) {
  await client.query(`
    insert into public.prospect_source_records (
      import_batch_id, source_record_id, record_type, organization_id, contact_id, source_ids
    )
    select
      $2::uuid, incoming.source_record_id, incoming.record_type, organization.id,
      contact.id,
      array(select jsonb_array_elements_text(incoming.source_ids))
    from jsonb_to_recordset($1::jsonb) as incoming(
      source_record_id text, record_type text, organization_identity_key text,
      contact_identity_key text, source_ids jsonb
    )
    join public.prospect_organizations organization
      on organization.identity_key = incoming.organization_identity_key
    left join public.prospect_contacts contact
      on contact.identity_key = incoming.contact_identity_key
    on conflict (import_batch_id, source_record_id) do update set
      record_type = excluded.record_type,
      organization_id = excluded.organization_id,
      contact_id = excluded.contact_id,
      source_ids = excluded.source_ids
  `, [JSON.stringify(sourceRows(plan)), batchId]);
}

async function aggregateForBatch(client, batchId) {
  const result = await client.query(`
    select
      count(*)::integer as source_records,
      count(distinct organization_id)::integer as organizations,
      count(distinct contact_id)::integer as contacts
    from public.prospect_source_records
    where import_batch_id = $1
  `, [batchId]);
  return result.rows[0];
}

function assertAggregates(plan, aggregates) {
  if (Number(aggregates.source_records) !== plan.batch.sourceRecordCount
    || Number(aggregates.organizations) !== plan.batch.organizationCount
    || Number(aggregates.contacts) !== plan.batch.contactCount) {
    throw new Error('prospect_import_aggregate_mismatch');
  }
}

async function applyImport(client, plan, actor) {
  await client.query('BEGIN');
  try {
    await client.query("set local statement_timeout = '120s'");
    await client.query("set local lock_timeout = '15s'");
    const batchId = await upsertBatch(client, plan, actor);
    await upsertOrganizations(client, plan, batchId);
    await upsertContacts(client, plan, batchId);
    await upsertSources(client, plan, batchId);
    const aggregates = await aggregateForBatch(client, batchId);
    assertAggregates(plan, aggregates);
    await client.query('update public.prospect_import_batches set verified_at = now() where id = $1', [batchId]);
    await client.query('COMMIT');
    return aggregates;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function verifyLive(client, plan) {
  const batch = await client.query(`
    select id, manifest_sha256
    from public.prospect_import_batches
    where source_sha256 = $1
  `, [plan.batch.sourceSha256]);
  if (!batch.rows[0]) throw new Error('prospect_import_batch_missing');
  if (batch.rows[0].manifest_sha256 !== plan.batch.manifestSha256) {
    throw new Error('prospect_manifest_mismatch');
  }
  const aggregates = await aggregateForBatch(client, batch.rows[0].id);
  assertAggregates(plan, aggregates);
  return aggregates;
}

function report(mode, plan, aggregates = null) {
  return {
    mode,
    workbook_sha256: plan.batch.sourceSha256,
    manifest_sha256: plan.batch.manifestSha256,
    organizations: Number(aggregates?.organizations ?? plan.batch.organizationCount),
    contacts: Number(aggregates?.contacts ?? plan.batch.contactCount),
    source_records: Number(aggregates?.source_records ?? plan.batch.sourceRecordCount),
    marketing_consent: 'unknown',
    outreach_status: 'unreviewed',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.source || !args.workbook) throw new Error('source_and_workbook_required');
  if (args.apply && args.verify_live) throw new Error('choose_apply_or_verify_live');

  const sourcePath = resolve(args.source);
  const workbookPath = resolve(args.workbook);
  const workbookSha256 = await sha256File(workbookPath);
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const plan = buildProspectImportPlan(source, { workbookSha256 });
  if (args.expected_workbook_sha) {
    if (!SHA256_RE.test(args.expected_workbook_sha) || args.expected_workbook_sha !== workbookSha256) {
      throw new Error('workbook_sha256_mismatch');
    }
  }

  if (!args.apply && !args.verify_live) {
    process.stdout.write(`${JSON.stringify(report('dry-run', plan), null, 2)}\n`);
    return;
  }
  if (!args.expected_workbook_sha) throw new Error('expected_workbook_sha_required');
  if (args.apply && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(args.actor || '')) throw new Error('actor_email_required');

  const envPath = resolve(args.env_file || '.dev.vars');
  const environment = { ...await parseEnvFile(envPath), ...process.env };
  verifyTarget(environment, args.expected_project_ref);
  const client = new Client({
    connectionString: environment.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    if (args.apply && args.migrate) {
      const schema = await readFile(new URL('../supabase/schema-crm-prospects.sql', import.meta.url), 'utf8');
      await client.query(schema);
    }
    await assertSchemaReady(client);
    const aggregates = args.apply
      ? await applyImport(client, plan, args.actor)
      : await verifyLive(client, plan);
    process.stdout.write(`${JSON.stringify(report(args.apply ? 'applied' : 'live-verified', plan, aggregates), null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const safe = String(error?.message || 'unknown_error').split('\n')[0].slice(0, 240);
  process.stderr.write(`prospect_import_failed:${safe}\n`);
  process.exitCode = 1;
});
