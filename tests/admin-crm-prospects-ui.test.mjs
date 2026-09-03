import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('js/admin/crm-workspace.js');
const prospects = read('js/admin/crm-prospects.js');
const prospectAccount = read('js/admin/crm-prospect-account.js');
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
  assert.match(prospectAccount, /data-prospect-link-toggle/);
  assert.match(prospectAccount, /data-prospect-company-search/);
  assert.match(prospectAccount, /data-prospect-link-company/);
  assert.match(prospectAccount, /data-prospect-company-create/);
  assert.match(prospectAccount, /action:\s*'create_company'/);
  assert.match(prospectAccount, /linked_company_id/);
  assert.match(prospectAccount, /No user is invited and no email is sent/i);
  assert.doesNotMatch(prospectAccount, /err\.data\?\.error/);
  assert.match(prospects, /minlength="2"/);
  assert.match(prospects, /state\.staff\?\.capabilities\?\.includes\('prospect\.write'\)/);
  assert.match(prospects, /Workflow saved\./);
});

test('prospect channels are structured, actionable, and URL-safe', () => {
  assert.match(prospectAccount, /data-prospect-channel="\$\{type\}"/);
  assert.match(prospectAccount, /channelItem\('email'/);
  assert.match(prospectAccount, /channelItem\('phone'/);
  assert.match(prospectAccount, /channelItem\('website'/);
  assert.match(prospectAccount, /mailto:/);
  assert.match(prospectAccount, /tel:/);
  assert.match(prospectAccount, /https?:/);
  assert.match(prospectAccount, /noopener noreferrer/);
});

test('prospect list and detail are responsive and use existing CRM primitives', () => {
  assert.match(css, /\.crm-prospect-tools/);
  assert.match(css, /\.crm-prospect-grid/);
  assert.match(css, /\.crm-prospect-detail/);
  assert.match(css, /\.crm-prospect-link-panel/);
  assert.match(css, /\.crm-prospect-link-panel\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.crm-prospect-channels/);
  assert.match(css, /\.crm-prospect-link-search\s*\{[^}]*grid-template-columns:\s*minmax\(220px, 1fr\) auto/);
  assert.match(css, /\.crm-prospect-company-create\s*\{[^}]*grid-template-columns:\s*minmax\(220px, 1fr\) auto minmax\(180px, \.6fr\)/);
  assert.match(css, /\.crm-prospect-detail\s*\{[^}]*padding:\s*0/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.crm-prospect-tools/);
  assert.match(prospects, /admListPager\(/);
  assert.match(prospects, /admSkeleton\(/);
  assert.match(prospects, /admEmpty\(/);
});

test('admin loads a cache-busted CRM workspace version', () => {
  assert.match(admin, /import\('\.\/admin\/crm-workspace\.js\?v=20260902d'\)/);
});

test('shared authenticated browser fixture covers the Prospect surface', () => {
  assert.match(authStub, /prospect\.write/);
  assert.match(authStub, /\/api\/admin\/crm\/prospects/);
  assert.match(authStub, /marketing_consent:\s*'unknown'/);
});
