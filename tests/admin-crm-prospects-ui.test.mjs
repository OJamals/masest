import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('js/admin/crm-workspace.js');
const prospects = read('js/admin/crm-prospects.js');
const css = read('css/components.css');
const admin = read('js/admin.js');
const authStub = read('tools/test-auth-stub.mjs');

test('CRM workspace owns one integrated Prospects view', () => {
  assert.match(workspace, /\['prospects', 'Prospects'\]/);
  assert.match(workspace, /createCrmProspects/);
  assert.match(workspace, /prospects\.render/);
  assert.match(workspace, /prospects\.wire/);
  assert.match(prospects, /\/api\/admin\/crm\/prospects/);
  assert.match(prospects, /data-prospect-form/);
  assert.match(prospects, /data-prospect-status/);
  assert.match(prospects, /data-prospect-open/);
  assert.match(prospects, /data-prospect-back/);
});

test('prospect UI makes consent and identity boundaries explicit', () => {
  assert.match(prospects, /No bulk marketing/i);
  assert.match(prospects, /unreviewed/i);
  assert.match(prospects, /Prospect organizations are not customer accounts/i);
  assert.match(prospects, /data-prospect-open-company/);
  assert.match(prospects, /minlength="2"/);
  assert.match(prospects, /state\.staff\?\.capabilities\?\.includes\('prospect\.write'\)/);
  assert.match(prospects, /Workflow saved\./);
});

test('prospect list and detail are responsive and use existing CRM primitives', () => {
  assert.match(css, /\.crm-prospect-tools/);
  assert.match(css, /\.crm-prospect-grid/);
  assert.match(css, /\.crm-prospect-detail/);
  assert.match(css, /\.crm-prospect-detail\s*\{[^}]*padding:\s*0/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.crm-prospect-tools/);
  assert.match(prospects, /admListPager\(/);
  assert.match(prospects, /admSkeleton\(/);
  assert.match(prospects, /admEmpty\(/);
});

test('admin loads a cache-busted CRM workspace version', () => {
  assert.match(admin, /import\('\.\/admin\/crm-workspace\.js\?v=20260902c'\)/);
});

test('shared authenticated browser fixture covers the Prospect surface', () => {
  assert.match(authStub, /prospect\.write/);
  assert.match(authStub, /\/api\/admin\/crm\/prospects/);
  assert.match(authStub, /marketing_consent:\s*'unknown'/);
});
