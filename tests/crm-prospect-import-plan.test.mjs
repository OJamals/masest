import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProspectImportPlan } from '../tools/lib/prospect-import-plan.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function row(overrides = {}) {
  return {
    master_id: 'MC-00001',
    record_type: 'Organization',
    company: 'Acme Mechanical',
    normalized_company: 'acme mechanical',
    contact_name: '',
    title: '',
    email: 'INFO@ACME.EXAMPLE',
    phone: '313-555-0100',
    linkedin: '',
    website: 'https://acme.example',
    segment: 'HVAC / Refrigeration',
    address: '1 Main St',
    city: 'Detroit',
    state: 'MI',
    postal_code: '48201',
    location: 'Detroit, MI',
    marketing_consent: 'Unknown — no bulk marketing',
    suppressed: 'Unknown',
    verify_flag: '',
    notes: 'must stay local',
    source_files: ['private-source.xlsx'],
    source_ids: ['SRC-1'],
    ...overrides,
  };
}

function source(master) {
  return {
    generated_on: '2026-09-02',
    summary: {
      master_records: master.length,
      unique_companies: new Set(master.map((entry) => entry.normalized_company)).size,
    },
    policy: { consent: 'Consent/lawful basis not present. Default blocks bulk marketing use.' },
    master,
  };
}

test('planner separates organizations, people, and non-PII source lineage', () => {
  const data = source([
    row(),
    row({
      master_id: 'MC-00002',
      record_type: 'Person',
      contact_name: 'Ada Buyer',
      title: 'Procurement',
      email: 'ADA@ACME.EXAMPLE',
      phone: '313-555-0101',
      source_ids: ['SRC-2'],
    }),
    row({
      master_id: 'MC-00003',
      record_type: 'Person',
      company: 'Beacon Facilities',
      normalized_company: 'beacon facilities',
      contact_name: 'Ben Buyer',
      email: '',
      phone: '313-555-0102',
      source_ids: ['SRC-3'],
    }),
  ]);

  const plan = buildProspectImportPlan(data, { workbookSha256: SHA_A });
  assert.equal(plan.organizations.length, 2);
  assert.equal(plan.contacts.length, 2);
  assert.equal(plan.sourceRecords.length, 3);
  assert.equal(plan.batch.sourceRecordCount, 3);
  assert.equal(plan.batch.organizationCount, 2);
  assert.equal(plan.batch.contactCount, 2);
  assert.match(plan.batch.manifestSha256, /^[0-9a-f]{64}$/);

  for (const entry of [...plan.organizations, ...plan.contacts]) {
    assert.equal(entry.marketingConsent, 'unknown');
    assert.equal(entry.outreachStatus, 'unreviewed');
    for (const key of ['notes', 'sourceFiles']) assert.equal(key in entry, false);
  }
  assert.equal(plan.contacts[0].email, 'ada@acme.example');
  assert.deepEqual(plan.sourceRecords[0].sourceIds, ['SRC-1']);
  for (const key of ['email', 'phone', 'name', 'notes']) assert.equal(key in plan.sourceRecords[0], false);
});

test('organization and contact identity remain stable across import batches', () => {
  const data = source([
    row({ record_type: 'Person', contact_name: 'Ada Buyer', email: 'ada@acme.example' }),
  ]);
  const first = buildProspectImportPlan(data, { workbookSha256: SHA_A });
  const second = buildProspectImportPlan(data, { workbookSha256: SHA_B });
  assert.equal(first.organizations[0].identityKey, second.organizations[0].identityKey);
  assert.equal(first.contacts[0].identityKey, second.contacts[0].identityKey);
  assert.notEqual(first.batch.sourceSha256, second.batch.sourceSha256);
});

test('planner fails closed on consent drift, duplicate IDs, or summary drift', () => {
  assert.throws(
    () => buildProspectImportPlan(source([row({ marketing_consent: 'Opted in' })]), { workbookSha256: SHA_A }),
    /prospect_consent_not_unknown/,
  );
  assert.throws(
    () => buildProspectImportPlan(source([row(), row()]), { workbookSha256: SHA_A }),
    /duplicate_master_id/,
  );
  const badSummary = source([row()]);
  badSummary.summary.master_records = 2;
  assert.throws(() => buildProspectImportPlan(badSummary, { workbookSha256: SHA_A }), /master_record_count_mismatch/);
});

test('planner requires a pinned source hash and known record types', () => {
  assert.throws(() => buildProspectImportPlan(source([row()]), { workbookSha256: 'bad' }), /invalid_workbook_sha256/);
  assert.throws(
    () => buildProspectImportPlan(source([row({ record_type: 'Lead' })]), { workbookSha256: SHA_A }),
    /invalid_record_type/,
  );
  const invalidDate = source([row()]);
  invalidDate.generated_on = '2026-02-31';
  assert.throws(() => buildProspectImportPlan(invalidDate, { workbookSha256: SHA_A }), /invalid_generated_on/);
});
