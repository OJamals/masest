import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/prospects.js', import.meta.url), 'utf8');

test('prospect API is staff-only, paginated, and migration-aware', () => {
  assert.match(src, /requireStaff\(request, env\)/);
  assert.match(src, /if \(!user\) return json\(401/);
  assert.match(src, /if \(!staff\) return json\(403/);
  assert.match(src, /prospectListParams\(url\.searchParams\)/);
  assert.match(src, /pageEnvelope\(/);
  assert.match(src, /needs_migration/);
});

test('list reads minimal organization rows and counts contacts separately', () => {
  assert.match(src, /from\('prospect_organizations'\)/);
  assert.match(src, /from\('prospect_contacts'\)\.select\('organization_id'\)/);
  assert.match(src, /contact_count/);
  assert.doesNotMatch(src, /select\('\*'/);
});

test('detail resolves contacts and linked Company context', () => {
  assert.match(src, /url\.searchParams\.get\('id'\)/);
  assert.match(src, /from\('prospect_contacts'\)[\s\S]*\.eq\('organization_id', id\)/);
  assert.match(src, /from\('companies'\)[\s\S]*linked_company_id/);
  assert.match(src, /from\('prospect_outreach_drafts'\)[\s\S]*\.eq\('organization_id', id\)/);
  assert.match(src, /prospect_outreach_drafts[\s\S]*\.limit\(25\)/);
});

test('secondary Prospect table misses return migration state', () => {
  assert.match(src, /contactResult\.error\)[\s\S]*isMissingProspectSchema\(contactResult\.error\)[\s\S]*needsMigration/);
  assert.match(src, /sourceResult\.error\)[\s\S]*isMissingProspectSchema\(sourceResult\.error\)[\s\S]*needsMigration/);
});

test('writes use bounded JSON, prospect capabilities, and audit', () => {
  assert.match(src, /readBoundedJson\(request, PROSPECT_REQUEST_MAX_BYTES\)/);
  assert.match(src, /staffCan\(role, 'prospect\.write'\)/);
  assert.match(src, /staffCan\(role, 'prospect\.delete'\)/);
  assert.match(src, /confirm.*erase/si);
  assert.match(src, /recordAudit\(/);
});

test('prospect API has no messaging or marketing side effect', () => {
  assert.doesNotMatch(src, /sendEmail|queueMarketingEmail|klaviyo|newsletter_recipients|publishSupportMessage/i);
});
