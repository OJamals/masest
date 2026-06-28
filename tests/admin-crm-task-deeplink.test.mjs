// Plan 007 — source-contract tests for task-row deep-link feature.
// Mirrors the inbox-api test style: pure static analysis of file contents,
// no mocks, no network, runs in < 1s.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const QUOTES_API = read('functions/api/admin/quotes.js');
const QUOTES_JS  = read('js/admin/quotes.js');
const COMPANIES  = read('js/admin/companies.js');
const ADMIN      = read('js/admin.js');
const WS         = read('js/admin/crm-workspace.js');

// ---- functions/api/admin/quotes.js ----------------------------------------

test('backend: QUOTE_SELECT const is defined and used in the list branch', () => {
  assert.match(QUOTES_API, /const QUOTE_SELECT\s*=/);
  // Both the list select and the single fetch must reference the const
  assert.match(QUOTES_API, /\.select\(QUOTE_SELECT,\s*\{[\s\S]*?count.*?\}/);
  assert.match(QUOTES_API, /\.select\(QUOTE_SELECT\)\.eq\('id'/);
});

test('backend: ?id= single-fetch returns { quote } or { error }', () => {
  assert.match(QUOTES_API, /\{\s*quote:\s*data\s*\}/);
  assert.match(QUOTES_API, /\{\s*error:\s*'not_found'\s*\}/);
});

test('backend: ?id= branch is gated — requires id AND no view AND not export=csv', () => {
  assert.match(QUOTES_API, /_singleId && !new URL\(request\.url\)\.searchParams\.get\('view'\)/);
  assert.match(QUOTES_API, /searchParams\.get\('export'\) !== 'csv'/);
});

test('backend: ?id= branch uses maybeSingle and returns needs_migration on schema error', () => {
  assert.match(QUOTES_API, /\.maybeSingle\(\)/);
  assert.match(QUOTES_API, /needs_migration:\s*true/);
});

test('backend: ?id= branch is placed after the export=csv branch', () => {
  // Backend uses searchParams.get('export') === 'csv'; frontend calls ?export=csv
  const exportIdx  = QUOTES_API.indexOf("get('export') === 'csv'");
  const singleIdx  = QUOTES_API.indexOf('_singleId');
  assert.ok(exportIdx > -1, "export=csv branch (get('export') === 'csv') not found");
  assert.ok(singleIdx > -1, '?id= branch not found');
  assert.ok(singleIdx > exportIdx, '?id= branch must come after export=csv branch');
});

test('backend: ?id= branch does not collide with view=contacts&id= branch', () => {
  // The view=contacts branch must appear before the _singleId branch
  const contactsIdx = QUOTES_API.indexOf("=== 'contacts'");
  const singleIdx   = QUOTES_API.indexOf('_singleId');
  assert.ok(contactsIdx > -1, "view=contacts branch not found");
  assert.ok(singleIdx > contactsIdx, '?id= branch must be after view=contacts branch');
});

// ---- js/admin/quotes.js ----------------------------------------------------

test('quotes.js: openQuoteById is defined and exported', () => {
  assert.match(QUOTES_JS, /async function openQuoteById\(id\)/);
  assert.match(QUOTES_JS, /return \{[^}]*openQuoteById[^}]*\}/);
});

test('quotes.js: openQuoteById fetches /api/admin/quotes?id=', () => {
  assert.match(QUOTES_JS, /\/api\/admin\/quotes\?id=/);
});

test('quotes.js: openQuoteById calls openQuoteDrawer when quote returned', () => {
  assert.match(QUOTES_JS, /if \(quote\) openQuoteDrawer\(quote\)/);
});

// ---- js/admin/companies.js -------------------------------------------------

test('companies.js: openCompanyDetail is included in the return object', () => {
  assert.match(COMPANIES, /return \{[^}]*openCompanyDetail[^}]*\}/);
});

// ---- js/admin.js -----------------------------------------------------------

test('admin.js: destructures openCompanyDetail from createCompaniesTab', () => {
  assert.match(ADMIN, /openCompanyDetail\s*\}.*createCompaniesTab|createCompaniesTab[\s\S]{0,300}openCompanyDetail/);
});

test('admin.js: destructures openQuoteById from createQuotesTab', () => {
  assert.match(ADMIN, /openQuoteById\s*\}.*createQuotesTab|createQuotesTab[\s\S]{0,300}openQuoteById/);
});

test('admin.js: openSubject function is defined at module scope', () => {
  assert.match(ADMIN, /function openSubject\(type,\s*id,\s*label\)/);
});

test('admin.js: openSubject maps company → setTab(companies) + openCompanyDetail', () => {
  assert.match(ADMIN, /setTab\('companies'\).*openCompanyDetail\(id\)|openCompanyDetail.*setTab\('companies'\)/s);
});

test('admin.js: openSubject maps quote → setTab(quotes) + openQuoteById', () => {
  assert.match(ADMIN, /setTab\('quotes'\).*openQuoteById\(id\)|openQuoteById.*setTab\('quotes'\)/s);
});

test('admin.js: openSubject maps contact → crm.openContactDrawer (no tab switch)', () => {
  assert.match(ADMIN, /crm\.openContactDrawer\(\s*\{[^}]*id[^}]*name[^}]*\}\s*\)/s);
});

test('admin.js: openSubject is passed into createCrmWorkspace', () => {
  assert.match(ADMIN, /createCrmWorkspace\(\{[^}]*openSubject[^}]*\}\)/s);
});

// ---- js/admin/crm-workspace.js ---------------------------------------------

test('crm-workspace.js: factory accepts openSubject in args', () => {
  assert.match(WS, /createCrmWorkspace\(\{[^}]*openSubject[^}]*\}\)|,\s*openSubject\s*\}/);
});

test('crm-workspace.js: taskRow emits data-inbox-open button', () => {
  assert.match(WS, /data-inbox-open/);
});

test('crm-workspace.js: taskRow emits data-subj-type, data-subj-id, data-subj-label', () => {
  assert.match(WS, /data-subj-type=/);
  assert.match(WS, /data-subj-id=/);
  assert.match(WS, /data-subj-label=/);
});

test('crm-workspace.js: Open button is guarded to known subject types', () => {
  // The canOpen guard must check all three types
  assert.match(WS, /subject_type.*===.*'company'|'company'.*===.*subject_type/);
  assert.match(WS, /subject_type.*===.*'quote'|'quote'.*===.*subject_type/);
  assert.match(WS, /subject_type.*===.*'contact'|'contact'.*===.*subject_type/);
});

test('crm-workspace.js: wireCrm delegates [data-inbox-open] to openSubject', () => {
  assert.match(WS, /delegate\(box,\s*'click',\s*'\[data-inbox-open\]'/);
  assert.match(WS, /openSubject\(btn\.dataset\.subjType,\s*btn\.dataset\.subjId,\s*btn\.dataset\.subjLabel\)/);
});

test('crm-workspace.js: existing toggle button and overdue badge are still present', () => {
  assert.match(WS, /data-inbox-toggle=/);
  assert.match(WS, /badge badge-warning.*Overdue|Overdue.*badge-warning/s);
});
