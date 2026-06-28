import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

test('q search branch present: reads q param and uses .or() with ilike filters', () => {
  assert.match(src, /url\.searchParams\.get\('q'\)/);
  assert.match(src, /\.or\(`name\.ilike\./);
  assert.match(src, /email\.ilike\./);
  assert.match(src, /phone\.ilike\./);
});

test('short query rejected with query_too_short', () => {
  assert.match(src, /query_too_short/);
  assert.match(src, /q\.length < 2/);
});

test('search branch caps at 100 rows and sorts by name', () => {
  assert.match(src, /\.limit\(100\)/);
  assert.match(src, /\.order\('name', \{ ascending: true \}\)\.limit\(100\)/);
});

test('company names resolved via batched companies lookup', () => {
  assert.match(src, /company_name/);
  assert.match(src, /\.from\('companies'\)\.select\('id,name'\)\.in\('id', companyIds\)/);
  assert.match(src, /new Set\(rows\.map\(\(r\) => r\.company_id\)/);
});

test('migration fallback present in search branch', () => {
  // needs_migration appears in both branches
  assert.ok((src.match(/needs_migration: true/g) || []).length >= 2);
});

test('company-scoped branch preserved: company_required guard still present', () => {
  assert.match(src, /company_required/);
  assert.match(src, /\.eq\('company_id', String\(companyId\)\)/);
  assert.match(src, /\.order\('is_primary', \{ ascending: false \}\)/);
  assert.match(src, /\.limit\(200\)/);
});

test('existing staff guard unchanged', () => {
  assert.match(src, /requireStaff/);
  assert.match(src, /staffCanWrite\(role\)/);
});

test('search strips .or()-breaking chars from the query', () => {
  assert.match(src, /q\.replace\(\/\[\(\),\]\/g, ' '\)/);
});
