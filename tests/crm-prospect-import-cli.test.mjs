import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url);

function source() {
  return {
    generated_on: '2026-09-02',
    summary: { master_records: 1, unique_companies: 1 },
    policy: { consent: 'Consent/lawful basis not present. Default blocks bulk marketing use.' },
    master: [{
      master_id: 'MC-00001',
      record_type: 'Organization',
      company: 'Acme Private Name',
      normalized_company: 'acme private name',
      contact_name: '', title: '', email: 'private@example.test', phone: '313-555-0100',
      linkedin: '', website: '', segment: 'HVAC', address: '', city: 'Detroit', state: 'MI',
      postal_code: '', location: '', marketing_consent: 'Unknown — no bulk marketing',
      suppressed: 'Unknown', verify_flag: '', source_ids: ['SRC-1'],
    }],
  };
}

test('import CLI defaults to local dry-run and emits no roster PII', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masest-prospect-cli-'));
  try {
    const workbook = join(dir, 'source.xlsx');
    const data = join(dir, 'source.json');
    await writeFile(workbook, 'pinned workbook bytes');
    await writeFile(data, JSON.stringify(source()));
    const result = spawnSync(process.execPath, [
      'tools/import-prospects.mjs', '--source', data, '--workbook', workbook,
    ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.organizations, 1);
    assert.equal(report.contacts, 0);
    assert.equal(report.source_records, 1);
    assert.equal(report.workbook_sha256, createHash('sha256').update('pinned workbook bytes').digest('hex'));
    assert.doesNotMatch(result.stdout, /Acme Private Name|private@example\.test|313-555-0100/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('apply path is exact-target, transactional, idempotent, and aggregate-verified', async () => {
  const src = await readFile(new URL('../tools/import-prospects.mjs', import.meta.url), 'utf8');
  assert.match(src, /--expected-project-ref/);
  assert.match(src, /--expected-workbook-sha/);
  assert.match(src, /SUPABASE_DB_URL/);
  assert.match(src, /await client\.query\('BEGIN'\)/);
  assert.match(src, /await client\.query\('COMMIT'\)/);
  assert.match(src, /await client\.query\('ROLLBACK'\)/);
  assert.match(src, /on conflict \(identity_key\) do update/i);
  assert.match(src, /on conflict \(import_batch_id, source_record_id\) do update/i);
  assert.match(src, /count\(distinct organization_id\)/i);
  assert.match(src, /count\(distinct contact_id\)/i);
  assert.doesNotMatch(src, /sendEmail|klaviyo|newsletter_recipients|publishSupportMessage/i);
});
