// Source-contract tests for the contact directory paging + role-filter additions
// in functions/api/admin/crm/contacts.js (plan 009).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

test('imports CONTACT_ROLES from crm-contacts.js', () => {
  assert.match(src, /CONTACT_ROLES.*from.*crm-contacts\.js/);
});

test('imports parsePage and pageEnvelope from paginate.js', () => {
  assert.match(src, /parsePage.*pageEnvelope.*from.*paginate\.js/);
});

test('directory branch reads role param and validates via CONTACT_ROLES.includes', () => {
  assert.match(src, /url\.searchParams\.get\('role'\)/);
  assert.match(src, /CONTACT_ROLES\.includes\(role\)/);
});

test('directory branch guard allows role-only search (q.length < 2 && !hasRole)', () => {
  assert.match(src, /q\.length < 2 && !hasRole/);
});

test('directory branch applies .eq(role) conditionally when hasRole is set', () => {
  assert.match(src, /if \(hasRole\) query = query\.eq\('role', role\)/);
});

test('directory branch uses parsePage with defaultLimit:50 maxLimit:100', () => {
  assert.match(src, /parsePage\(url\.searchParams, \{ defaultLimit: 50, maxLimit: 100 \}\)/);
});

test('directory branch uses .range(offset, offset + limit - 1) with count:exact', () => {
  assert.match(src, /\.range\(offset, offset \+ limit - 1\)/);
  assert.match(src, /\{ count: 'exact' \}/);
});

test('directory branch spreads pageEnvelope into response', () => {
  assert.match(src, /pageEnvelope\(rows, \{ limit, offset, count \}\)/);
  assert.match(src, /\.\.\.pageEnvelope\(/);
});

test('directory branch applies .or() conditionally when q.length >= 2', () => {
  assert.match(src, /if \(q\.length >= 2\)/);
  assert.match(src, /query = query\.or\(`name\.ilike/);
});

test('company-scoped branch still has .eq(company_id) and .limit(200) — unchanged', () => {
  assert.match(src, /\.eq\('company_id', String\(companyId\)\)/);
  assert.match(src, /\.limit\(200\)/);
});

test('company_name enrichment batch lookup still present', () => {
  assert.match(src, /company_name/);
  assert.match(src, /\.from\('companies'\)\.select\('id,name'\)\.in\('id', companyIds\)/);
});

test('needs_migration fallback still present in directory branch', () => {
  assert.ok((src.match(/needs_migration: true/g) || []).length >= 2);
});
